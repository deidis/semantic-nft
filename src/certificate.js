import fs from 'fs'
import {extractSignature} from '@signpdf/utils'
import CertificateOfAuthenticity from './CertificateOfAuthenticity.js'
import {artworkURIs} from './metadata.js'
import path from 'path'

export const CERTIFICATE_FILE_NAME_WITHOUT_EXT = 'certificate'
export const CERTIFICATE_SUPPORTED_INFO_TAGS = ['Author', 'Title', 'Subject']

/**
 * @param {object} preparedMetadata
 * @private
 */
export async function prepareCertificates(preparedMetadata) {
  const promises = []
  artworkURIs(preparedMetadata).forEach((artworkUri) => {
    promises.push((new CertificateOfAuthenticity(artworkUri, preparedMetadata)).build())
  })

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

      // TODO: (phase 2) for extra caution we might want to check if content valid
    }
  })

  return result
}

/**
 * @param {string} absoluteFilePathOrUri
 * @return {boolean}
 */
export function isSigned(absoluteFilePathOrUri) {
  absoluteFilePathOrUri = absoluteFilePathOrUri.replace('file://', '')
  try {
    extractSignature(fs.readFileSync(absoluteFilePathOrUri))
    return true
  } catch (e) {
    return false
  }
}
