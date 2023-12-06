const {ExifTool} = require('exiftool-vendored')

/**
 * Retrieves a user by email.
 * @method
 * @param {ExifTool} exiftool - ExifTool instance
 * @param {string[]} files - List of files for which we want to clean up the metadata
 */
async function cleanup(exiftool, files) {
  const promises = []
  files.forEach((file) => {
    promises.push(exiftool.deleteAllTags(file))
  })
  return Promise.all(promises)
}

module.exports = {
  cleanup,
}
