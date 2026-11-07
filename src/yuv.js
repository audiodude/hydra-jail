// Canvas → planar YUV (BT.709, limited range) on the GPU, for encoding, in 8 or 10 bits.
// Chrome's own conversion of canvas frames is full range, which players that ignore the range flag
// (VLC) stretch as if limited: +16% contrast, darks crushed to black, gradient steps exaggerated.
// 10 bits also keeps gradients that 8-bit YUV bands (blue worst of all: it's ~7% of luma).
// The fragment shader writes the I420 byte layout directly (Y plane, then U, then V), packed into
// RGBA8 pixels, so one readPixels yields the frame's buffer.

const VS = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); // one triangle covering the viewport
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D src;
uniform uint W, H, TW, bits; // frame size, target width, bits per sample
out vec4 o;

vec3 rgb(uint x, uint y) { return texelFetch(src, ivec2(x, y), 0).rgb; }

// Sample s of the I420 layout. Limited range: Y in 16..235, Cb/Cr in 16..240 (scaled up for 10-bit).
uint sampleAt(uint s) {
  float maxv = float((1u << bits) - 1u), unit = float(1u << (bits - 8u));
  uint cw = W / 2u, ch = H / 2u;
  vec3 c;
  int plane = 0;
  if (s < W * H) c = rgb(s % W, s / W);
  else {
    uint t = s - W * H;
    plane = t < cw * ch ? 1 : 2;
    if (plane == 2) t -= cw * ch;
    uint x = (t % cw) * 2u, y = (t / cw) * 2u;
    c = (rgb(x, y) + rgb(x + 1u, y) + rgb(x, y + 1u) + rgb(x + 1u, y + 1u)) * 0.25;
  }
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float v = unit * (plane == 0 ? 16.0 + 219.0 * luma
    : 128.0 + 224.0 * (plane == 1 ? (c.b - luma) / 1.8556 : (c.r - luma) / 1.5748));
  return uint(clamp(floor(v + 0.5), 0.0, maxv));
}

void main() {
  uint p = uint(gl_FragCoord.y) * TW + uint(gl_FragCoord.x);
  if (bits == 8u) {
    uint s = p * 4u;
    o = vec4(sampleAt(s), sampleAt(s + 1u), sampleAt(s + 2u), sampleAt(s + 3u)) / 255.0;
  } else { // two little-endian 16-bit samples
    uint s = p * 2u, a = sampleAt(s), b = sampleAt(s + 1u);
    o = vec4(a & 255u, a >> 8, b & 255u, b >> 8) / 255.0;
  }
}`;

const COLOR_SPACE = { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false };

export function createYuvConverter(width, height, bits) {
  const bytesPerSample = bits > 8 ? 2 : 1;
  const tw = (width * bytesPerSample) / 4, th = (height * 3) / 2;
  const gl = new OffscreenCanvas(tw, th).getContext('webgl2', { antialias: false, depth: false, premultipliedAlpha: false });
  if (!gl) throw new Error('WebGL2 is unavailable');

  const program = gl.createProgram();
  for (const [type, text] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, FS]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, text);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`YUV shader: ${gl.getShaderInfoLog(shader)}`);
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`YUV shader: ${gl.getProgramInfoLog(program)}`);
  gl.useProgram(program);
  const u = (name) => gl.getUniformLocation(program, name);
  gl.uniform1ui(u('W'), width);
  gl.uniform1ui(u('H'), height);
  gl.uniform1ui(u('TW'), tw);
  gl.uniform1ui(u('bits'), bits);

  const texture = (w, h) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    if (w) gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
    return t;
  };
  const out = texture(tw, th);
  gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out, 0);
  const src = texture(); // left bound to unit 0, which `src` samples by default
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  // Premultiplied = composited over black, as the canvas looks live on its black background.
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.viewport(0, 0, tw, th);

  const bytes = new Uint8Array(tw * th * 4);
  const data = bytesPerSample === 2 ? new Uint16Array(bytes.buffer) : bytes;
  return {
    // A WebGL canvas must be converted in the same task as its draw: its buffer isn't preserved.
    frame(source) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.readPixels(0, 0, tw, th, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      return new VideoFrame(data, {
        format: bits > 8 ? 'I420P10' : 'I420', codedWidth: width, codedHeight: height, timestamp: 0, colorSpace: COLOR_SPACE,
      });
    },
    destroy() { gl.getExtension('WEBGL_lose_context')?.loseContext(); },
  };
}
