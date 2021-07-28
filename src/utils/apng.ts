import { crc32 } from 'crc';

// https://github.com/TomasHubelbauer/node-apng/blob/master/index.js
export function makeAnimatedPNG(buffers: Buffer[], delay: DelayFn) {
  const actl = Buffer.alloc(20);
  actl.writeUInt32BE(8, 0); // Length of chunk
  actl.write('acTL', 4); // Type of chunk
  actl.writeUInt32BE(buffers.length, 8); // Number of frames
  actl.writeUInt32BE(0, 12); // Number of times to loop (0 - infinite)
  actl.writeUInt32BE(crc32(actl.slice(4, 16)), 16); // CRC

  let sequenceNumber = 0;
  const frames = buffers.map((data, index) => {
    const ihdr = findChunk(data, 'IHDR');

    if (ihdr === null) {
      throw new Error('IHDR chunk not found!');
    }

    const fctl = Buffer.alloc(38);
    fctl.writeUInt32BE(26, 0); // Length of chunk
    fctl.write('fcTL', 4); // Type of chunk
    fctl.writeUInt32BE(sequenceNumber++, 8); // Sequence number
    fctl.writeUInt32BE(ihdr.readUInt32BE(8), 12); // Width
    fctl.writeUInt32BE(ihdr.readUInt32BE(12), 16); // Height
    fctl.writeUInt32BE(0, 20); // X offset
    fctl.writeUInt32BE(0, 24); // Y offset
    const { numerator, denominator } = delay(index);
    fctl.writeUInt16BE(numerator, 28); // Frame delay - fraction numerator
    fctl.writeUInt16BE(denominator, 30); // Frame delay - fraction denominator
    fctl.writeUInt8(0, 32); // Dispose mode
    fctl.writeUInt8(0, 33); // Blend mode
    fctl.writeUInt32BE(crc32(fctl.slice(4, 34)), 34); // CRC

    let offset = 8;
    const fdats = [];
    while (true) {
      const idat = findChunk(data, 'IDAT', offset);
      if (idat === null) {
        if (offset === 8) {
          throw new Error('No IDAT chunks found!');
        }
        else {
          break;
        }
      }

      offset = idat.byteOffset + idat.length;

      // All IDAT chunks except first one are converted to fdAT chunks
      if (index === 0) {
        fdats.push(idat);
      } else {
        const length = idat.length + 4;
        const fdat = Buffer.alloc(length);
        fdat.writeUInt32BE(length - 12, 0); // Length of chunk
        fdat.write('fdAT', 4); // Type of chunk
        fdat.writeUInt32BE(sequenceNumber++, 8); // Sequence number
        idat.copy(fdat, 12, 8); // Image data
        fdat.writeUInt32BE(crc32(fdat.slice(4, length - 4)), length - 4); // CRC
        fdats.push(fdat);
      }
    }

    return Buffer.concat([fctl, ...fdats]);
  });

  const signature = Buffer.from('89504e470d0a1a0a', 'hex');
  const ihdr = findChunk(buffers[0], 'IHDR');
  if (ihdr === null) {
    throw new Error('IHDR chunk not found!');
  }

  const iend = Buffer.from('0000000049454e44ae426082', 'hex');
  return Buffer.concat([signature, ihdr, actl, ...frames, iend]);
}

function findChunk(buffer: Buffer, type: string, offset = 8) {
  while (offset < buffer.length) {
    const chunkLength = buffer.readUInt32BE(offset);
    const chunkType = buffer.slice(offset + 4, offset + 8).toString('ascii');

    if (chunkType === type) {
      return buffer.slice(offset, offset + chunkLength + 12);
    }

    offset += 4 + 4 + chunkLength + 4;
  }

  return null;
}

export interface DelayFn {
  (frameIndex: number): ({ numerator: number, denominator: number });
}