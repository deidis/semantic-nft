const fs = require('fs')
const path = require('path')
const TOML = require('@iarna/toml')

/**
 * Ingests the given TOML files into images
 * @param {string[]} tomlFilePaths - Absolute paths to the TOML files
 */
function ingest(tomlFilePaths) {
  tomlFilePaths.forEach((filePath) => {
    const workingArtworkFiles = _resolveArtworkWorkingFilesPathsFromToml(filePath)
    console.debug(`${path.relative(process.cwd(), filePath)} describes \
      the following artworks:\n${JSON.stringify(workingArtworkFiles, null, 2)}`)
  })
}

/**
 * @param {string} filePath - Absolute path to the TOML file
 * @return {{string: string}} - A map of the absolute paths to the headers in the TOML file
 * @private
 */
function _resolveArtworkWorkingFilesPathsFromToml(filePath) {
  const tomlFile = require('fs').readFileSync(filePath, 'utf8')
  const tomlJson = TOML.parse(tomlFile)

  const artworkWorkingFilesPaths = {}
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
       *
       * The working files will be:
       * 1. ./portrait/artwork.png
       * 2. ./landscape/artwork.png
       * 3. ./home/abc/square/artwork.png
       *
       * In the 2nd case we actually need to look up the file first in the current dir,
       * to figure out the extension of the file.
       */
      const artworkTomlHeader = tomlJsonKey

      if (path.isAbsolute(artworkTomlHeader)) {
        if (fs.existsSync(artworkTomlHeader)) {
          const stats = fs.statSync(artworkTomlHeader)
          if (!stats.isDirectory() && stats.exists()) {
            const ext = path.extname(artworkTomlHeader)
            const artworkFileBaseName = path.basename(artworkTomlHeader, ext)
            const artworkWorkingFilePath = path.dirname(artworkTomlHeader) +
                path.sep +
                artworkFileBaseName +
                path.sep +
                'artwork' + ext
            if (fs.existsSync(artworkWorkingFilePath)) {
              artworkWorkingFilesPaths[artworkTomlHeader] = artworkWorkingFilePath
            }
          }
        }
      } else {
        // Relative path to the toml file
        let ext = path.extname(artworkTomlHeader)
        if (ext.length === 0) {
          // No extension, so we need to look up the file(s)
          // in the directory of the tom file to figure out the extension
          const artworkFileBaseNameWithoutExtension = path.basename(artworkTomlHeader)
          ext = fs.readdirSync(path.dirname(filePath))
              .filter((fileName) => fileName.startsWith(artworkFileBaseNameWithoutExtension))
              .map((fileName) => path.extname(fileName))
              .filter((extName) => extName.length > 1)
        }
        if (!Array.isArray(ext)) {
          ext = [ext]
        }

        for (let i = 0; i < ext.length; i++) {
          const artworkWorkingFilePath = path.dirname(filePath) +
              path.sep +
              path.basename(artworkTomlHeader, ext[i]) +
              path.sep +
              'artwork' + ext[i]
          if (fs.existsSync(artworkWorkingFilePath)) {
            artworkWorkingFilesPaths[artworkTomlHeader] = artworkWorkingFilePath
          }
        }
      }
    }
  }

  return artworkWorkingFilesPaths
}

module.exports = {
  ingest
}
