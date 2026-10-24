class JonPcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.framesPerChunk = 4096;
    this.frame = 0;
    this.buffer = new ArrayBuffer(this.framesPerChunk * 2 * 2);
    this.view = new DataView(this.buffer);
  }
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (output) for (const channel of output) channel.fill(0);
    if (!input || !input.length || !input[0] || !input[0].length) return true;
    const left = input[0];
    const right = input.length > 1 && input[1] ? input[1] : left;
    for (let i = 0; i < left.length; i++) {
      const l = Math.max(-1, Math.min(1, left[i]));
      const r = Math.max(-1, Math.min(1, right[i]));
      const offset = this.frame * 4;
      this.view.setInt16(offset, l < 0 ? l * 32768 : l * 32767, true);
      this.view.setInt16(offset + 2, r < 0 ? r * 32768 : r * 32767, true);
      this.frame++;
      if (this.frame === this.framesPerChunk) {
        this.port.postMessage(this.buffer, [this.buffer]);
        this.buffer = new ArrayBuffer(this.framesPerChunk * 2 * 2);
        this.view = new DataView(this.buffer);
        this.frame = 0;
      }
    }
    return true;
  }
}
registerProcessor("jon-pcm-capture", JonPcmCapture);
