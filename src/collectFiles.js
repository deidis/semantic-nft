const fs = require('fs')
const path = require('path')

const IMAGE_FILE_TYPES = [
  'jpg',
  'jpeg',
  'png',
  'gif',
  'tiff',
  'tif',
  'webp',
  'heic',
  'heif',
]

/**
 * @param {string} filePath - absolute path to file or directory
 * @param {number} depth - how deep to search for files in directories
 * @param {string[]} fileTypesByExtensionName - array of file extensions to search for
 * @return {string[]} - array of absolute paths to files
 */
function collectFiles(filePath, depth = 0, fileTypesByExtensionName = IMAGE_FILE_TYPES) {
  const result = []
  try {
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath)
      if (stats.isDirectory()) {
        if (filePath.startsWith('.')) {
          return result
        } else {
          result.push(..._collectFilesInDir(filePath, depth))
        }
      } else if (stats.isFile()) {
        result.push(filePath)
      }
    }
  } catch (err) {
    console.error(`Error accessing path: ${filePath}`, err)
  }

  return result.filter((file) => {
    const extension = file.split('.').pop().toLowerCase()
    return fileTypesByExtensionName.includes(extension) || fileTypesByExtensionName.includes(`.${extension}`)
  })
}

/**
 * @param {string} dir - absolute path to directory
 * @param {number} depth - how deep to search for files in directories
 * @param {number} currentDepth - current depth of recursion
 * @return {string[]} - array of absolute paths to files
 * @private
 */
function _collectFilesInDir(dir, depth, currentDepth = 0) {
  const result = []

  if (currentDepth > depth) return result

  let files = []
  try {
    files = fs.readdirSync(dir)
  } catch (err) {
    console.error(`Error reading directory: ${dir}`, err)
    return result
  }

  files.forEach((file) => {
    const filePath = path.join(dir, file)
    const stats = fs.statSync(filePath)

    if (stats.isDirectory()) {
      result.push(..._collectFilesInDir(filePath, depth, currentDepth + 1))
    } else if (stats.isFile()) {
      result.push(filePath)
    }
  })
  return result
}

module.exports = {
  collectFiles,
}
