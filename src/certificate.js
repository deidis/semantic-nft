import fs from 'fs'
import {extractSignature} from '@signpdf/utils'
import CertificateOfAuthenticity from './CertificateOfAuthenticity.js'
import {artworkURIs, enrichSchemaAssociatedMedia} from './metadata.js'
import path from 'path'
import {createHash} from 'node:crypto'

export const CERTIFICATE_FILE_NAME_WITHOUT_EXT = 'certificate'
export const CERTIFICATE_SUPPORTED_INFO_TAGS = ['Author', 'Title', 'Subject']

/**
 * @param {object} preparedMetadata
 * @private
 */
export async function prepareCertificates(preparedMetadata) {
  const promises = []
  artworkURIs(preparedMetadata).forEach((artworkUri) => {
    promises.push(
        (new CertificateOfAuthenticity(artworkUri, preparedMetadata)).build().then((absoluteCertificatePath) => {
          if (absoluteCertificatePath) {
            enrichSchemaAssociatedMedia(preparedMetadata[artworkUri], {
              '@type': 'MediaObject',
              'identifier': path.basename(absoluteCertificatePath),
              'contentUrl': `file://${absoluteCertificatePath}`,
              'additionalProperty': {
                '@type': 'PropertyValue',
                'name': 'sha256',
                'value': createHash('sha256').update(fs.readFileSync(absoluteCertificatePath)).digest('hex')
              },
            })
          }
        })
    )
  })
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

      if (result) {
        enrichSchemaAssociatedMedia(preparedMetadata[artworkUri], {
          '@type': 'MediaObject',
          'identifier': `${CERTIFICATE_FILE_NAME_WITHOUT_EXT}.pdf`,
          'contentUrl': `file://${absolutePathToCertificate}`,
          'additionalProperty': {
            '@type': 'PropertyValue',
            'name': 'sha256',
            'value': createHash('sha256').update(fs.readFileSync(absoluteCertificatePath)).digest('hex')
          },
        })
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
