import PDFDocument from 'pdfkit'
import fs from 'fs'
import path from 'path'
import {CERTIFICATE_FILE_NAME_WITHOUT_EXT, isSigned, CERTIFICATE_SUPPORTED_INFO_TAGS} from './certificate.js'
import {exiftool} from 'exiftool-vendored'

// Create and export a class that creates a PDF with pdfkit and is made for inheritance
/**
 * @class CertificateOfAuthenticity
 */
export default class CertificateOfAuthenticity {
  #metadata = null
  /** @type {PDFDocument} */
  #pdf = null
  #artworkUri = null
  #certificateUri = null

  /**
   * @constructor
   * @param {string} artworkWorkingFileUri - The URI of the artwork (normalized TOML header)
   * @param {object} preparedMetadata - The metadata from the TOML, ready to be used
   */
  constructor(artworkWorkingFileUri, preparedMetadata) {
    this.#metadata = preparedMetadata
    this.#artworkUri = artworkWorkingFileUri

    const certificateMeta = preparedMetadata[artworkWorkingFileUri]['XMP-xmpRights:Certificate']
    const certificateUriIsInlineTable = (typeof certificateMeta === 'object' &&
        certificateMeta !== null &&
        !Array.isArray(certificateMeta))

    if (certificateUriIsInlineTable) {
      this.#certificateUri = Object.keys(certificateMeta)[0]
    } else {
      this.#certificateUri = certificateMeta
      // Make it inline table
      if (this.#certificateUri) {
        this.#metadata[artworkWorkingFileUri]['XMP-xmpRights:Certificate'] = {
          [this.#certificateUri]: {},
        }
      }
    }

    this.#pdf = new PDFDocument({font: 'Helvetica'})
  }

  /**
   * Call it right after instantiation to build the whole PDF
   *
   * @method build
   * @return {Promise<string|null>} - The file uri to the PDF working file,
   * if copying wasn't possible it will return null
   */
  async build() {
    if (this.#certificateUri) {
      const workingCertificateAbsolutePath =
          `${path.dirname(this.#artworkUri)}/${CERTIFICATE_FILE_NAME_WITHOUT_EXT}.pdf`
              .replace('file://', '')

      if (this.#certificateUri === `file://${workingCertificateAbsolutePath}`) {
        const writeStream = fs.createWriteStream(workingCertificateAbsolutePath)
        const promiseFromStream = new Promise((resolve, reject) => {
          writeStream.on('finish', () => {
            resolve()
          })
          writeStream.on('error', (err) => {
            reject(err)
          })
        })
        this.#pdf.pipe(writeStream)
        await this.render()
        this.#pdf.end()
        return promiseFromStream.then(() => {
          return this.#certificateUri
        })
      } else {
        if (fs.existsSync(this.#certificateUri.replace('file://', ''))) {
          // The file is supposed to exist, so we copy it over and then proceed
          fs.copyFileSync(this.#certificateUri.replace('file://', ''), workingCertificateAbsolutePath)
          const newCertificateUri = `file://${workingCertificateAbsolutePath}`

          // The certificate info is in the artwork as inline table as well as separately, so we fix the table name in both
          this.#metadata[this.#artworkUri]['XMP-xmpRights:Certificate'][newCertificateUri] =
              this.#metadata[this.#artworkUri]['XMP-xmpRights:Certificate'][this.#certificateUri]
          delete this.#metadata[this.#artworkUri]['XMP-xmpRights:Certificate'][this.#certificateUri]

          this.#certificateUri = newCertificateUri
          await this._applyInfoTags()
        } else {
          console.warn(`Cannot copy the certificate ${this.#certificateUri.replace('file://', '')}. Not found.`)
          delete this.#metadata[this.#artworkUri]['XMP-xmpRights:Certificate']
        }
      }

      return this.#certificateUri
    }
    return null
  }

  /**
   * @return {object}
   */
  get certificate() {
    return this.#metadata[this.#artworkUri]['XMP-xmpRights:Certificate'][this.#certificateUri]
  }

  /**
   * @method _applyInfoTags
   * @private
   */
  async _applyInfoTags() {
    const certificateAbsolutePath = this.#certificateUri.replace('file://', '')
    const fileExists = fs.existsSync(certificateAbsolutePath)
    if (fileExists) {
      // Check if certificate is actually signed,
      // in this case don't overwrite the metadata or the signature would become invalid
      if (!isSigned(certificateAbsolutePath)) {
        const infoTags = this.pdfInfoTagsFromMetadata()

        if (Object.keys(infoTags).length > 0) {
          return exiftool.write(
              certificateAbsolutePath,
              infoTags,
              ['-xmptoolkit=', '-overwrite_original'])
        }
      }
    }
  }

  /**
   * Override it for different template purposes
   * @method render
   */
  async render() {
    this.#pdf.text('Electronic Autograph')
    const vars = this.pdfVariablesFromMetadata()

    // TODO: do the rendering here
    for (const pdfVariablesFromMetadataKey in vars) {
      if (pdfVariablesFromMetadataKey) {
        this.#pdf.text(`${pdfVariablesFromMetadataKey}: ${vars[pdfVariablesFromMetadataKey]}`)
      }
    }
  }

  /**
   * @method pdfInfoTagsFromMetadata
   * @return {{string:string[]}}
   */
  pdfInfoTagsFromMetadata() {
    const result = {}
    Object.keys(this.certificate).filter((key) => {
      // Take only supported fields
      return key.toLowerCase().startsWith('xmp-pdf:') ||
          CERTIFICATE_SUPPORTED_INFO_TAGS.includes(key.charAt(0).toUpperCase() + key.toLowerCase().slice(1))
    }).forEach((key) => {
      result[key] = this.certificate[key].toString()
    })

    return result
  }

  /**
   * @method pdfVariablesFromMetadata
   * @return {{string:string[]}}
   */
  pdfVariablesFromMetadata() {
    const infoTags = this.pdfInfoTagsFromMetadata()
    const result = {}
    Object.keys(this.certificate).filter((key) => {
      return !Object.keys(infoTags).includes(key.toLowerCase())
    }).forEach((key) => {
      result[key] = this.certificate[key].toString()
    })

    return result
  }
}
