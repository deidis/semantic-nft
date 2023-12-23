import path from 'path'
import {collectFiles} from '../src/collectFiles.js'
import {calculateCID, calculateWrappedCID, fileUriToIpfsUri} from '../src/ipfs.js'

try {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    console.log('Please provide a file')
    process.exit(1)
  }

  // Collect files from the arguments
  const files = args.flatMap((arg) => {
    return collectFiles(path.resolve(arg), 0, '*')
  })

  if (files.length === 0) {
    console.log('No files found')
    process.exit(1)
  }

  console.log(await calculateWrappedCID(files))
  for (const file of files) {
    console.log('-' + file, await calculateCID(file))
  }


  // console.log(JSON.stringify(metadata, null, 2))
} catch (err) {
  console.error(err)
} finally {
  console.log('Done.')
}
