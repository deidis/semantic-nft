import fs from 'fs'
import {extractSignature} from '@signpdf/utils'
import CertificateOfAuthenticity from './CertificateOfAuthenticity.js'
import {artworkURIs} from './metadata.js'
import path from 'path'

export const CERTIFICATE_FILE_NAME_WITHOUT_EXT = 'certificate'

/**
 * @param {object} preparedMetadata
 * @private
 */
export async function prepareCertificates(preparedMetadata) {
  const promises = []
  artworkURIs(preparedMetadata).forEach((artworkUri) => {
    promises.push((new CertificateOfAuthenticity(artworkUri, preparedMetadata)).build())
  })
  // TODO: apply the metadata on the pdf if it's not signed
  // The metadata to adjust:
  // - checksum of the artwork

  return Promise.all(promises)
}

/**
 * @param {object} preparedMetadata
 * @param {boolean} quiet if true, returns false instead of throwing an error
 * @return {boolean}
 * @throws {Error}
 * @private
 */
export function checkCertificates(preparedMetadata, quiet = false) {
  let result = true
  artworkURIs(preparedMetadata).forEach((artworkUri) => {
    const certificateMeta = preparedMetadata[artworkUri]['XMP-xmpRights:Certificate']
    if (certificateMeta && Object.keys(certificateMeta).length > 0) {
      // As it's defined, we are sure it must exist in the working folder.
      // So rather trust this fact instead of taking the path from the metadata, as it might not be fully prepared yet.
      const absolutePathToCertificate = path.dirname(artworkUri.replace('file://', '')) +
          path.sep + CERTIFICATE_FILE_NAME_WITHOUT_EXT + '.pdf'
      if (!fs.existsSync(absolutePathToCertificate)) {
        if (quiet) {
          result = false
        } else {
          throw new Error(`Certificate file ${absolutePathToCertificate} does not exist`)
        }
      }
      if (!isSigned(absolutePathToCertificate)) {
        if (quiet) {
          result = false
        } else {
          throw new Error(`Certificate file ${absolutePathToCertificate} is not signed`)
        }
      }

      // TODO: for extra caution we might want to check if the artwork checksum and other info is mentioned (content valid?)
    }
  })

  return result
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
