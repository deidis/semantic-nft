# Semantic NFT

This project is an implementation of the metadata management architecture of digital assets proposed in
[this documentation by silvermind.art](https://docs.silvermind.art/fundamentals/digital-asset).

## Installation

```bash
pnpm install
```

## Usage

Check the version of the exiftool that's in use (and in general if the code works):

```bash
pnpm run version
```

### Metadata management

We use [TOML](https://toml.io/en/) for collecting metadata that we will need to create the NFT.

#### TOML for artwork metadata
In the context of an artwork metadata (as we want to put correct things into the image itself) we prescribe the tags in one or more `.toml` files.

In [Silvermind docs](https://docs.silvermind.art/fundamentals/digital-asset/artwork-metadata) we describe how we use XMP-dc (Dublin Core vocabulary) and a bit of Exif vocabulary to add the semantic metadata to the image. To make it even simpler, in the `.toml` file we assume that the group of the vocabulary is always "XMP-dc" unless specified otherwise. Check the [example project](./nft-workspace/example-project) for how to add/clear tags.

Behind the scenes we use [ExifTool](https://exiftool.org). The main thing to remember is that ExifTool prioritizes groups like this: 1) EXIF, 2) IPTC, 3) XMP. Whereas, we prioritize like this: 1) XMP-dc 2) EXIF 3) IPTC, 4) XMP other.

By the way, ExifTool processes tags case-insensitive, so no stress when writing `.toml`. However internally we transform all the tags. Cases for vocabularies (groups) that we use:
- XMP-dc
- XMP-xmpRights
- exif
- IPTC
- XMP

Example 1:

```toml
["artwork.png"]
ImageDescription = "ImageDescription field"
```

```toml
["artwork.png"]
title = "title field"
```

According to Silvermind we put the same value into XMP-dc:Title and exif:ImageDescription, therefore both `.toml` files will bring us to the same result, i.e. that both tags will have the same value.

Example 2:

```toml
["artwork.png"]
"exif:ImageDescription" = "ImageDescription field"
```

```toml
["artwork.png"]
"XMP-dc:title" = "title field"
```

Now we specify the group and therefore after running both files we actually set only specific field in each case. 


**IMPORTANT** Please note that some of the metadata, such as the URI of the certificate of authenticity, identifier, etc. might not be available untl the moment when the NFT is minted. Therefore, be prepared to add them later ([Silvermind digital minting service](https://www.silvermind.art) will help with th).

For privacy purposes and cleanness, we **clear all the metadata** from the image and add what's provided in the `.toml` file(s). However, one can also take a different approach, and actually write/clear only specific tags.

### Digital artefact creation

So we have an artwork and metadata. Now we need to prepare for the minting. We need to create:

- Enrich the original image with metadata
- Create a preview image
- Create the (encrypted) digital artefact, composed of:
  - Artwork
  - Preview image
  - License information
  - Certificate of authenticity
  - Information about the artwork (human-readable metadata)

# Credits

As example photos we use [picsum.photos](https://picsum.photos) which are taken from [Unsplash](https://unsplash.com) and licensed as [public domain](https://unsplash.com/license).

- landscape [download](https://picsum.photos/id/867/4288/2848) [info](https://picsum.photos/id/867/info)
- portrait [download](https://picsum.photos/id/997/2528/3735) [info](https://picsum.photos/id/997/info)
- square [download](https://picsum.photos/id/670/1367) [info](https://picsum.photos/id/670/info)


# More on the topic

- [Silvermind docs](https://docs.silvermind.art)
- Research
  - [Semantics and Non-Fungible Tokens for Copyright Management on the Metaverse and beyond](https://arxiv.org/pdf/2208.14174.pdf)
