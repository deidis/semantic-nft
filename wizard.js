const {collect} = require('./src/collect')
const {clean} = require('./src/clean')
const inquirer = require('inquirer')
const path = require('path')
const fs = require('fs')
const {ingest} = require('./src/ingest')

const args = process.argv.slice(2)
if (args.length === 0) {
  console.log('Please provide a path to the artwork file, multiple files or a directory.')
  process.exit(1)
}

// Collect files from the arguments
const files = []
args.forEach((arg) => {
  // It's very likely that media files are organized in subfolders,
  // so let's collect them recursively at least one level deep.
  const recursionLevel = 1
  // filePath can be relative or absolute, so we need to resolve it
  files.push(...collect(path.resolve(arg), recursionLevel))
})

// Process collected files
if (files.length > 0) {
  console.log(`Processing ${files.length} files.`)

  // For every file create a folder and copy the file into it,
  // this way we don't touch the original files and accumulate all the progress in one place.
  const workingArtworkFiles = []
  files.forEach((file) => {
    const dir = path.dirname(file)
    const ext = path.extname(file)
    const basename = path.basename(file, ext)
    const newDir = path.join(dir, basename)
    if (!fs.existsSync(newDir)) {
      fs.mkdirSync(newDir)
    }
    const newFile = path.join(newDir, /* path.basename(file) */ 'artwork' + ext)
    fs.copyFileSync(file, newFile)
    workingArtworkFiles.push(newFile)
  })

  const exiftool = require('exiftool-vendored').exiftool

  files.forEach((file) => {
    console.log(`- ${path.relative(process.cwd(), file)}`)
  })

  inquirer.prompt([
    {
      type: 'confirm',
      name: 'clean',
      message: 'Step 1: Clear all metadata for these files?',
      default: true,
    }
  ]).then((answers) => {
    if (answers.clean) {
      console.log('Clearing metadata...')
      return clean(exiftool, workingArtworkFiles)
    } else {
      return Promise.resolve()
    }
  }).then(() => {
    // For every artwork there might be a toml file, we look for it in the same folder.
    const artworkTomlFiles = []
    files.forEach((file) => {
      // list the dir for files ending with .toml
      const tomlFilePaths = fs.readdirSync(path.dirname(file)).filter((file) => {
        return path.basename(file).startsWith('art-') && file.endsWith('.toml')
      })
      tomlFilePaths.forEach((tomlFilePath) => {
        const resolvedTomlFilePath = path.join(path.dirname(file), tomlFilePath)
        if (!artworkTomlFiles.includes(resolvedTomlFilePath)) {
          artworkTomlFiles.push(resolvedTomlFilePath)
        }
      })
    })
    // Make it unique
    artworkTomlFiles.filter((value, index, self) => {
      return self.indexOf(value) === index
    })

    if (artworkTomlFiles.length > 0) {
      artworkTomlFiles.forEach((file) => {
        console.log(`- ${path.relative(process.cwd(), file)}`)
      })

      return inquirer.prompt([
        {
          type: 'confirm',
          name: 'toml',
          // The order of files is important,
          // to change the order one can play with the names of the files.
          message: 'Step 2: Apply the files as metadata?',
          default: true,
        }
      ]).then((answers) => {
        if (answers.toml) {
          console.log('Applying metadata...')
          return ingest(artworkTomlFiles)
        } else {
          return Promise.resolve()
        }
      })
    }

    return Promise.resolve()
  }).then(() => {
    //
  }).finally(() => {
    exiftool.end(true).finally(() => {
      console.log('Done.')
    })
  })
} else {
  console.log('No files found to process')
}
