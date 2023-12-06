const {ExifTool} = require('exiftool-vendored')

/**
 * Deletes all metadata for the given files
 * @method
 * @param {ExifTool} exiftool - ExifTool instance
 * @param {string[]} files - List of files for which we want to clean up the metadata
 * @return {Promise} Promise object represents the result of the operation
 */
function clean(exiftool, files) {
  const promises = []
  files.forEach((file) => {
    // promises.push(exiftool.write(file, {}, ['-all=', '-v']))

    // For some reason exiftool-vendored is throwing an error when we try to clear all metadata multiple times
    promises.push(exiftool.deleteAllTags(file).catch((err) => {
      if (err.message.startsWith('No success message')) {
        return 'No success message. Consider successful.'
      } else {
        throw err
      }
    }))
  })
  return Promise.all(promises)
}

module.exports = {
  clean
}
