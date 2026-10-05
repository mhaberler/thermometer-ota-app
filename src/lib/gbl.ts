// A GBL file starts with the header tag 0x03A617EB, stored little-endian.
const GBL_HEADER_TAG = [0xeb, 0x17, 0xa6, 0x03]

export function isGbl(image: Uint8Array): boolean {
  return image.length > GBL_HEADER_TAG.length
    && GBL_HEADER_TAG.every((b, i) => image[i] === b)
}
