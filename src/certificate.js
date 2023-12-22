import fs from 'fs'
import {extractSignature} from '@signpdf/utils'
import CertificateOfAuthenticity from './CertificateOfAuthenticity.js'
import {artworkURIs} from './metadata.js'

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
