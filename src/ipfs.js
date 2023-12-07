import {
  createFileEncoderStream,
  CAREncoderStream,
} from 'ipfs-car'
import {filesFromPaths} from 'files-from-path'

/**
 * @param {string} absoluteFilePath
 * @return {Promise<string>} - CID which is actually the last block CID, aka root CID
 */
export async function calculateCID(absoluteFilePath) {
  const files = await filesFromPaths([absoluteFilePath])
  let rootCID
  await createFileEncoderStream(files[0])
      .pipeThrough(new TransformStream({
        transform(block, controller) {
          rootCID = block.cid
          // console.log(block.cid.toString())
          controller.enqueue(block)
        }
      }))
      .pipeThrough(new CAREncoderStream())
      .pipeTo(new WritableStream())

  return rootCID.toString()
}
