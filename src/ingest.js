const path = require('path')
const TOML = require('@iarna/toml')
const {collect} = require('./collect')
const {ExifTool} = require('exiftool-vendored')

const __METADATA_CACHE = {}
const __CACHE_KEY = (tomlFileAbsolutePaths) => {
  return tomlFileAbsolutePaths.sort().join('|')
}

/**
 * Ingests the given TOML files into images
 * @param {ExifTool} exiftool - ExifTool instance
 * @param {string[]|undefined|null} tomlFilePaths - Absolute paths to the TOML files
 * @return {Promise<void>}
 */
function ingest(exiftool, tomlFilePaths) {
  const metadata = getMetadata(tomlFilePaths)
  // console.debug(JSON.stringify(metadata, null, 2))
  const commonMetadata = commonMetadataForAllArtworks(metadata)
  const ingestingPromises = []
  artworkURIs().forEach((artworkURI) => {
    ingestingPromises.push(_ingestMetadataForSpecificArtwork(exiftool, artworkURI, commonMetadata).then(() => {
      return _ingestMetadataForSpecificArtwork(exiftool, artworkURI, metadata[artworkURI]).then(() => {
        console.log(`Ingested metadata into ${artworkURI}`)
      })
    }).catch((err) => {
      console.error(`Failed to ingest metadata into ${artworkURI}: ${err}`)
    }))
  })
  return Promise.all(ingestingPromises)
}

/**
 * Ingests the given metadata into the given artwork file
 * @param {ExifTool} exiftool - ExifTool instance
 * @param {string} artworkPath
 * @param {any} tags
 * @return {Promise<void>}
 * @private
 */
function _ingestMetadataForSpecificArtwork(exiftool, artworkPath, tags) {
  artworkPath = artworkPath.replace('file://', '')
  return exiftool.write(artworkPath, tags, ['-xmptoolkit=', '-overwrite_original', '-v'])
}

/**
 * Prepares or retrieves the metadata from the cache.
 *
 * @param {string[]|undefined|null} tomlFileAbsolutePaths - Absolute paths to the TOML files
 * @return {any} - The TOML files as JSON
 */
function getMetadata(tomlFileAbsolutePaths) {
  if (typeof tomlFileAbsolutePaths === 'undefined' || tomlFileAbsolutePaths === null) {
    if (Object.keys(__METADATA_CACHE).length === 0) {
      return {}
    } else {
      // Normally it's only one record in the cache anyway
      return __METADATA_CACHE[Object.keys(__METADATA_CACHE)[0]]
    }
  }

  return prepareMetadata(tomlFileAbsolutePaths)
}

/**
 * Merge all the TOML files into a single JSON object.
 * Also resolve the table headers into absolute artwork file paths
 *
 * @param {string[]} tomlFileAbsolutePaths
 * @return {any} - The TOML files as JSON
 */
function prepareMetadata(tomlFileAbsolutePaths) {
  const cachekey = __CACHE_KEY(tomlFileAbsolutePaths)
  if (__METADATA_CACHE[cachekey]) {
    return __METADATA_CACHE[cachekey]
  }
  const result = {}
  tomlFileAbsolutePaths.forEach((tomlFileAbsolutePath) => {
    const tomlFile = require('fs').readFileSync(tomlFileAbsolutePath, 'utf8')
    const tomlJson = TOML.parse(tomlFile)
    // NOTE: This is a shallow merge, so if there are duplicate keys, the last one wins
    Object.assign(result, tomlJson)

    // Now resolve the table headers into absolute file paths
    const describedArtworks = _mentionedArtworks(tomlFileAbsolutePath, tomlJson)
    for (const tomlTableHeader in describedArtworks) {
      if (Object.keys(tomlJson[tomlTableHeader]).length !== 0) {
        const artworkFileAbsolutePaths = describedArtworks[tomlTableHeader] || []
        artworkFileAbsolutePaths.forEach((artworkFileAbsolutePath) => {
          const artworkFileURI = `file://${artworkFileAbsolutePath}`
          result[artworkFileURI] = result[artworkFileURI] || {}
          result[artworkFileURI] = Object.assign(result[artworkFileURI], tomlJson[tomlTableHeader])
        })
        delete result[tomlTableHeader]
      }
    }
  })

  // TODO: recognize the keys in metadata and convert them into tags

  __METADATA_CACHE[cachekey] = result

  return result
}

/**
 * @param {string} absoluteTomlFilePath - Absolute path to the toml file
 * @param {any} tomlJson - parsed toml file
 * @return {{string: string[]}} - A map of headers to absolute paths to the artwork files
 * @private
 */
function _mentionedArtworks(absoluteTomlFilePath, tomlJson) {
  /** @type {{string: string[]}} */
  const result = {}

  // Iterate over json and find the keys that are mapped to an object
  // eslint-disable-next-line guard-for-in
  for (const tomlJsonKey in tomlJson) {
    const value = tomlJson[tomlJsonKey]
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      // We found a table in toml, which in our case means that it's about an artwork.
      /*
       * Resolve the path to the working file of the artwork,
       * which is supposed to be in a subfolder of the directory where the toml file is.
       * For example, the toml file may have:
       * ["portrait.png"]
       * ...
       * ["landscape"]
       * ...
       * ["/home/abc/square.png"]
       * ...
       */
      const artworkTomlHeader = tomlJsonKey
      let artworkPathWithoutWildcard = artworkTomlHeader
      if (artworkTomlHeader.endsWith('*')) {
        artworkPathWithoutWildcard = artworkTomlHeader.substring(0, artworkTomlHeader.length - 1)
      }

      if (artworkPathWithoutWildcard.endsWith('/')) {
        let searchPath = artworkPathWithoutWildcard
        if (!path.isAbsolute(artworkPathWithoutWildcard)) {
          searchPath = path.resolve(path.dirname(absoluteTomlFilePath) +
              path.sep +
              artworkPathWithoutWildcard)
        }
        result[artworkTomlHeader] = collect(searchPath, 0)
      } else {
        let searchPath = artworkPathWithoutWildcard
        if (!path.isAbsolute(artworkPathWithoutWildcard)) {
          searchPath = path.resolve(path.dirname(absoluteTomlFilePath) +
              path.sep +
              artworkPathWithoutWildcard)
        }
        const fileNameGivenWithExtension = path.extname(artworkPathWithoutWildcard).length > 1
        if (!fileNameGivenWithExtension) {
          searchPath = path.dirname(searchPath)
        }
        let artworkFilePaths = collect(searchPath, 0)
        if (!fileNameGivenWithExtension) {
          artworkFilePaths = artworkFilePaths.filter((filePath) => {
            return path.basename(filePath).
                startsWith(path.basename(artworkPathWithoutWildcard))
          })
        }
        result[artworkTomlHeader] = artworkFilePaths
      }

      if (result[artworkTomlHeader].length === 0) {
        delete result[artworkTomlHeader]
      }
    }
  }

  return result
}

const commonMetadataForAllArtworks = (metadata) => {
  const tomlJson = metadata || getMetadata()
  const result = {}
  for (const tomlJsonKey in tomlJson) {
    if (!(typeof tomlJson[tomlJsonKey] === 'object' &&
        tomlJson[tomlJsonKey] !== null &&
        !Array.isArray(tomlJson[tomlJsonKey]))) {
      result[tomlJsonKey] = tomlJson[tomlJsonKey]
    }
  }
  return result
}

const artworkURIs = (metadata) => {
  return Object.keys(metadata || getMetadata()).filter((key) => {
    return key.startsWith('file:///')
  })
}

module.exports = {
  ingest,
  prepareMetadata
}
