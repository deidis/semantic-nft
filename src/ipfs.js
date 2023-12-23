import {
  createFileEncoderStream,
  CAREncoderStream, createDirectoryEncoderStream,
} from 'ipfs-car'
import {filesFromPaths} from 'files-from-path'

/**
 * @param {string} absoluteFilePathOrUri
 * @return {Promise<string>} - CID which is actually the last block CID, aka root CID
 */
export async function calculateCID(absoluteFilePathOrUri) {
  absoluteFilePathOrUri = absoluteFilePathOrUri.replace('file://', '')
  const files = await filesFromPaths([absoluteFilePathOrUri])
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

/**
 * @param {string[]} absoluteFilePathOrUri
 * @return {Promise<string>} - CID which is actually the last block CID, aka root CID
 */
export async function calculateWrappedCID(absoluteFilePathOrUri) {
  const paths = absoluteFilePathOrUri.flatMap((uri) => uri.replace('file://', ''))

  const files = await filesFromPaths(paths)
  let rootCID
  await createDirectoryEncoderStream(files)
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

/**
 * @param {string} fileUri
 * @return {Promise<string>}
 */
export async function fileUriToIpfsUri(fileUri) {
  const cid = await calculateCID(fileUri)
  return `ipfs://${cid}`
}
