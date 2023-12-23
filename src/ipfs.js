import {
  createFileEncoderStream,
  CAREncoderStream, createDirectoryEncoderStream,
} from 'ipfs-car'
import {filesFromPaths} from 'files-from-path'
import dotenv from 'dotenv'


dotenv.config()

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

/**
 * @param {string} ipfsUriOrCID
 * @param {"nftstorage.link" | "dweb.link"} gatewayHost
 * @param {"path" | "subdomain"} urlStyle
 * @return {string}
 */
export function ipfsUriToHttpsUri(
    ipfsUriOrCID,
    gatewayHost = process.env.IPFS_GATEWAY_HOST,
    urlStyle = process.env.IPFS_GATEWAY_URL_STYLE) {
  const cid = ipfsUriOrCID.replace('ipfs://', '')

  switch (urlStyle) {
    case 'path':
      return `https://${gatewayHost}/ipfs/${cid}`
    case 'subdomain':
    default:
      const cidSplits = cid.split('/')
      return `https://${cidSplits[0]}.ipfs.${gatewayHost}` + (cidSplits.length > 1 ? `/${cidSplits.slice(1).join('/')}` : '')
  }
}

/**
 * @param {string} fileUri
 * @param {"nftstorage.link" | "dweb.link"} gatewayHost
 * @param {"path" | "subdomain"} urlStyle
 * @return {Promise<string>}
 */
async function fileUriToHttpsUri(
    fileUri,
    gatewayHost = process.env.IPFS_GATEWAY_HOST,
    urlStyle = process.env.IPFS_GATEWAY_URL_STYLE) {
  const ipfsUri = await fileUriToIpfsUri(fileUri)
  return ipfsUriToHttpsUri(ipfsUri, gatewayHost, urlStyle)
}
