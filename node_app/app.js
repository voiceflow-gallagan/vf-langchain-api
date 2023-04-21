// 2163763d50b52c4e58148108501a71b7af753221a0826a0a38d6c2974ec5
// 83fa7485170fa8db32beb15174294d8a75f73ef82a1f16d480e4cb4bd486
// ab62333e40ca8d09b82e3c7b3f8818b2ed7bc2bf9a4e0bfae7b263430c01
// acf91cd1a11d81fc55d3564d6bd8fb0ff07cd86e66a3017410303feecce5
// 0396c72098209d1a0b7717dd675d9ae8ac2e3b123fab7c51f4aa905e4bae
// 345c68869e3224b840b97fe9c3b060231a3c2dad050df875501e3958ad50
// c0ad0e367bb3a0cbf4b18f0f09d6082272f22b321b0797c6dea76a0bcc9e

// 932d002736d156478f770babf8e9d25439aa2fbdff0927b18aaa7b064c0f
// voiceflow-doc-1000-250

import express from 'express'
import http from 'http'
import crypto from 'crypto'

import { HNSWLib } from 'langchain/vectorstores/hnswlib'
import { WebBrowser } from 'langchain/tools/webbrowser'
import { ChatOpenAI } from 'langchain/chat_models/openai'
import { ChromaClient } from 'chromadb'
import { Chroma } from 'langchain/vectorstores/chroma'
import { OpenAIEmbeddings } from 'langchain/embeddings/openai'
import { PromptTemplate } from 'langchain/prompts'
import { OpenAI } from 'langchain/llms/openai'
import { RedisCache } from 'langchain/cache/redis'
import { createClient } from 'redis'
import { PDFLoader } from 'langchain/document_loaders/fs/pdf'
import { DirectoryLoader } from 'langchain/document_loaders/fs/directory'
import { LLMChain, VectorDBQAChain } from 'langchain/chains'
import { CheerioWebBaseLoader } from 'langchain/document_loaders/web/cheerio'
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter'
import { Document } from 'langchain/document'
import SitemapXMLParser from 'sitemap-xml-parser'
import * as fs from 'fs/promises'

// Load environment variables from .env file
import * as dotenv from 'dotenv'
dotenv.config()

// Redis cache
const client = createClient({
  url: 'redis://redis:6379',
})
const cache = new RedisCache(client)
client.connect()
client.on('error', (err) => {
  console.error('Error connecting to Redis:', err)
})

client.on('ready', () => {
  console.log('Connected to Redis server.')
})

const cdb = new ChromaClient('http://chromadb:8000')

/*
const cdb = new ChromaClient('http://chroma_server:8000')

async function countCollection(name) {
  const collection = await cdb.getCollection(name)
  let ccount = await collection.count()
  console.log('ccount', ccount)
  return ccount
}

async function listCollections() {
  let list = await cdb.listCollections()
  console.log('list', list)
  return list
}
listCollections()
*/

// Setup the secret phrase and IV
const key = crypto.createHash('sha256').update(process.env.SECRET).digest()
const iv = Buffer.alloc(16)

// Set up Express app
const app = express()

// Middleware to parse JSON request bodies
app.use(express.urlencoded({ extended: true }))
app.use(express.json())

// Create HTTP server
http.createServer(app).listen(process.env.PORT)
console.info('Voiceflow Langchain API is listening on port ' + process.env.PORT)

app.get('/api/health', async (req, res) => {
  // Return the response to the user
  res.json({
    success: true,
    message: 'Server is healthy',
  })
})

app.get('/api/clearcache', async (req, res) => {
  try {
    client.sendCommand(['FLUSHDB'], (err, result) => {
      if (err) {
        console.error('Error flushing database:', err)
      } else {
        console.log('Database flushed:', result)
      }
    })

    // Return the response to the user
    res.json({ success: true, message: 'Cache cleared' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Error processing the request' })
  }
})

app.delete('/api/collection', async (req, res) => {
  const { name } = req.body
  if (!name) {
    res.status(500).json({ message: 'Missing collection name' })
  }
  try {
    const cdb = new ChromaClient()
    await cdb.getCollection(name)
    let error = await cdb.deleteCollection(name)

    // Return the response to the user
    if (!error) {
      res.json({
        success: true,
        message: `Collection ${name} has been deleted`,
        result,
      })
    } else {
      res.json({
        success: false,
        message: `Error deleting ${name}`,
        error,
      })
    }
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Error processing the request' })
  }
})

app.post('/api/pdf', async (req, res) => {
  const { url, apikey } = req.body
  const loader = new PDFLoader(
    'src/document_loaders/example_data/example.pdf',
    {
      splitPages: false,
    }
  )
  const docs = await loader.load()
  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 2500,
    chunkOverlap: 200,
  })

  const docOutput = await textSplitter.splitDocuments(docs)
  // Create an AES-256-CBC cipher using the secret phrase and IV
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv)
  let encrypted = cipher.update(apikey, 'utf8', 'base64')
  encrypted += cipher.final('base64')
  const directory = `./${cleanFilePath(encrypted)}/`

  // Create a new document for the URL
  let vectorStore
  let already = false

  try {
    // Load the vector store from the exisiting directory
    vectorStore = await HNSWLib.load(directory, new OpenAIEmbeddings())

    // Load the JSON file
    const data = await fs.readFile(`${directory}docstore.json`)
    const db = JSON.parse(data)

    // Check if metadata with the same source already exists
    const source = url
    const exists = db.some(
      ([id, { metadata }]) => metadata && metadata.source === source
    )

    // Check if the source already exists
    if (exists) {
      already = true
      console.log(`Source "${source}" already exists`)
    } else {
      console.log(`Source "${source}" added to vector store`)
      await vectorStore.addDocuments(docOutput)
    }
  } catch (err) {
    // If the vector store doesn't exist yet, create a new one
    vectorStore = await HNSWLib.fromDocuments(docOutput, new OpenAIEmbeddings())
  }

  // Save the vector store to a directory
  await vectorStore.save(directory)

  try {
    // Return the response to the user
    res.json({ response: 'success', already: already })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Error processing conversation request' })
  }
})

app.post('/api/web', async (req, res) => {
  const { url, query, temperature = 0 } = req.body
  if (!url || !query) {
    res.status(500).json({ message: 'Missing URL/Query' })
  }
  try {
    const model = new ChatOpenAI({
      temperature: temperature,
    })
    const embeddings = new OpenAIEmbeddings()

    const browser = new WebBrowser({ model, embeddings })

    const result = await browser.call(`"${url}","${query}"`)

    // Return the response to the user
    res.json({ response: result })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Error processing the request' })
  }
})

// Question endpoint
app.post('/api/question', async (req, res) => {
  // Get the search query and APIKey from the request body
  const { question, apikey } = req.body

  // Create an AES-256-CBC cipher using the secret phrase and IV
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv)

  // Encrypt the APIKey using the cipher
  let encrypted = cipher.update(apikey, 'utf8', 'base64')
  encrypted += cipher.final('base64')

  // Instantiate the OpenAI model
  const llm = new OpenAI({
    //modelName: 'gpt-3.5-turbo',
    modelName: 'gpt-4',
    concurrency: 5,
    cache: true,
    temperature: 0,
  })

  // Use the encrypted APIKey as the directory name
  const directory = `./${cleanFilePath(encrypted)}/`
  // Load the vector store from the same directory
  let vectorStore
  try {
    vectorStore = await HNSWLib.load(directory, new OpenAIEmbeddings())
  } catch (err) {
    // If the vector store doesn't exist yet, create a default one
    vectorStore = null
  }

  try {
    if (vectorStore) {
      // Load the Q&A map reduce chain
      const chain = VectorDBQAChain.fromLLM(llm, vectorStore)
      const response = await chain.call({
        query: question,
      })

      // Return the response to the user
      res.json({ response: response.text })
    } else {
      // We don't have a vector store yet, so we'll just use a template
      const template =
        "Your are a kind AI Assistant. Try to answer the following question: {question} If you don't know the answer, just say \"Hmm, I'm not sure.\" Don't try to make up an answer."
      const prompt = new PromptTemplate({
        template: template,
        inputVariables: ['question'],
      })
      const chain = new LLMChain({ llm: llm, prompt: prompt })
      const response = await chain.call({ question: question })

      // Return the response to the user
      res.json({ response: cleanText(response.text) })
    }
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Error processing the request' })
  }
})

app.post('/api/parser', async (req, res) => {
  const { url, apikey } = req.body
  const loader = new CheerioWebBaseLoader(url)
  const docs = await loader.load()

  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 2500,
    chunkOverlap: 200,
  })

  const docOutput = await textSplitter.splitDocuments(docs)
  // Create an AES-256-CBC cipher using the secret phrase and IV
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv)
  let encrypted = cipher.update(apikey, 'utf8', 'base64')
  encrypted += cipher.final('base64')
  const directory = `./${cleanFilePath(encrypted)}/`

  // Create a new document for the URL
  let vectorStore
  let already = false

  try {
    // Load the vector store from the exisiting directory
    vectorStore = await HNSWLib.load(directory, new OpenAIEmbeddings())

    // Load the JSON file
    const data = await fs.readFile(`${directory}docstore.json`)
    const db = JSON.parse(data)

    // Check if metadata with the same source already exists
    const source = url
    const exists = db.some(
      ([id, { metadata }]) => metadata && metadata.source === source
    )

    // Check if the source already exists
    if (exists) {
      already = true
      console.log(`Source "${source}" already exists`)
    } else {
      console.log(`Source "${source}" added to vector store`)
      await vectorStore.addDocuments(docOutput)
    }
  } catch (err) {
    // If the vector store doesn't exist yet, create a new one
    vectorStore = await HNSWLib.fromDocuments(docOutput, new OpenAIEmbeddings())
  }

  // Save the vector store to a directory
  await vectorStore.save(directory)

  try {
    // Return the response to the user
    res.json({ response: 'success', already: already })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Error processing conversation request' })
  }
})

function cleanFilePath(filePath) {
  // Define a regular expression that matches all non-alphanumeric characters and hyphens
  const regex = /[^a-zA-Z0-9\-]/g
  // Replace all non-matching characters with an empty string
  const cleanedFilePath = filePath.replace(regex, '')
  return cleanedFilePath
}

function cleanText(text) {
  // Define a regular expression that matches all newlines in the beginning of the string
  const regex = /^[\n]+/
  const cleanedText = text.replace(regex, '')
  return cleanedText
}

function generateUniqueId(inputString) {
  const timestamp = new Date().getTime()
  const randomValue = Math.random().toString(36).substring(2, 10)
  const uniqueId = `${inputString}-${timestamp}-${randomValue}`

  // Create a hash to make the unique ID have a fixed length
  const hash = crypto.createHash('sha256')
  hash.update(uniqueId)
  const hashDigest = hash.digest('hex')

  // Return a string with a maximum length of 60 characters
  // Chroma limit is 63 characters
  return hashDigest.substring(0, 60)
}

const sleepWait = (ms) => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function parseSitmap(url, filter, limit) {
  const options = {
    delay: 4000,
    limit: 1,
  }

  const sitemapXMLParser = new SitemapXMLParser(url, options)

  return sitemapXMLParser.fetch().then((result) => {
    let list = result
      .map((item) => item.loc[0].trim().replace(/\r\n/g, ' '))
      .filter((item) => !filter || item.includes(filter))
    return limit ? list.slice(0, limit) : list
  })
}

app.post('/api/sitemap', async (req, res) => {
  const {
    url,
    filter,
    limit,
    chunkSize = 2000,
    chunkOverlap = 250,
    sleep = 0,
  } = req.body

  if (!url) {
    res.status(500).json({ message: 'Missing URL and/or Name' })
  }
  try {
    let collection = generateUniqueId(process.env.SECRET)
    const sitemap = await parseSitmap(url, filter, limit)
    console.log(sitemap)
    const asyncFunction = async (item) => {
      console.log('Adding >>', item)
      await addURL(item, collection, chunkSize, chunkOverlap)
    }

    const iterateAndRunAsync = async (array) => {
      for (const item of array) {
        await asyncFunction(item)
        await sleepWait(sleep)
      }
    }

    iterateAndRunAsync(sitemap).then(async () => {
      console.log('Done!')
      console.log('Collection:', collection)
      // console.log('Count:', await countCollection(collection))
    })

    // Return the response to the user
    res.json({ response: 'started', collection: collection })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Error processing the request' })
  }
})

async function addURL(url, collection, chunkSize, chunkOverlap) {
  let vectorStore
  let loader = new CheerioWebBaseLoader(url)
  let docs = await loader.load()
  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: chunkSize,
    chunkOverlap: chunkOverlap,
  })

  const docOutput = await textSplitter.splitDocuments(docs)
  // Create a new document for the URL
  vectorStore = await Chroma.fromDocuments(docOutput, new OpenAIEmbeddings(), {
    collectionName: collection,
    url: 'http://chromadb:8000',
  })

  console.log('Added!')
  vectorStore = null
}

app.post('/api/doc', async (req, res) => {
  // Get the search query and APIKey from the request body
  const {
    question,
    collection,
    model = 'gpt-3.5-turbo',
    temperature = 0,
    max_tokens = 400,
  } = req.body

  // Instantiate the OpenAI model
  const llm = new OpenAI({
    modelName: model,
    concurrency: 15,
    //maxConcurrency: 5,
    //timeout: 10000,
    cache, //: true,
    temperature: temperature,
  })

  // Load the vector store from the same directory
  let vectorStore
  try {
    vectorStore = await Chroma.fromExistingCollection(new OpenAIEmbeddings(), {
      collectionName: collection,
      url: 'http://chromadb:8000',
    })
  } catch (err) {
    console.log('Collection not found!')
    vectorStore = null
  }

  try {
    if (vectorStore) {
      // Load the Q&A map reduce chain
      const chain = VectorDBQAChain.fromLLM(llm, vectorStore, {
        returnSourceDocuments: true,
      })
      const response = await chain.call({
        query: question,
      })
      vectorStore = null

      // Get the sources from the response
      let sources = response.sourceDocuments
      sources = sources.map((sources) => sources.metadata.source)
      // Remove duplicates
      sources = [...new Set(sources)]
      console.log('Sources:', sources)
      // Return the response to the user
      res.json({ response: response.text, sources })
    } else {
      console.log('No vector store found.')
      // We don't have a vector store yet, so we'll just use a template
      const template =
        "Your are a helpful AI Assistant. Try to answer the following question: {question} If you don't know the answer, just say \"Hmm, I'm not sure.\" Don't try to make up an answer."
      const prompt = new PromptTemplate({
        template: template,
        inputVariables: ['question'],
      })
      const chain = new LLMChain({ llm: llm, prompt: prompt })
      const response = await chain.call({ question: question })

      // Return the response to the user
      res.json({ response: cleanText(response.text) })
    }
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Error processing the request' })
  }
})
