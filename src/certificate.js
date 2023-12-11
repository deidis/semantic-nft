import fs from 'fs'
import {extractSignature} from '@signpdf/utils'
import BasicCertificateOfAuthenticity from './BasicCertificateOfAuthenticity.js'
import {artworkURIs} from './metadata.js'

export const CERTIFICATE_FILE_NAME_WITHOUT_EXT = 'certificate'

/**
 * @param {object} preparedMetadata
 * @private
 */
export async function prepareCertificates(preparedMetadata) {
  const promises = []
  artworkURIs(preparedMetadata).forEach((artworkUri) => {
    promises.push((new BasicCertificateOfAuthenticity(artworkUri, preparedMetadata)).build())
  })
  // TODO: copy or generate the certificate files in the working dir, and adjust the metadata
  // TODO: apply the metadata on the pdf if it's not signed
  // The metadata to adjust:
  // - checksum of the artwork
  // - CID of the artwork? WE PROBABLY SHOULD GET RID OF IT
  // - change refs to the certificate in the working folder, original is now irrelevant

  return Promise.all(promises)
}

/**
 * @param {string} absoluteFilePath
 * @return {boolean}
 */
export function isSigned(absoluteFilePath) {
  try {
    extractSignature(fs.readFileSync(absoluteFilePath))
    return true
  } catch (e) {
    return false
  }
}
