/*
NTU-Crawlee-ES-Integration with ENV-based Elasticsearch configuration

This basic Node.js application performs the following:
1. Uses Crawlee to crawl and scrape https://www.ntu.edu.tw/
2. Sends all scraped data to Elasticsearch.
3. Reads the Elasticsearch endpoint and API key from environment variables.

Instructions:
1. Make sure Node.js is installed.
2. Run: npm install crawlee @elastic/elasticsearch dotenv
3. Create a .env file with:
   ES_ENDPOINT="<your-elasticsearch-endpoint>"
   ES_API_KEY="<your-elasticsearch-api-key>"
4. Save this file (e.g., ntu-crawler.js).
5. Run it with: node ntu-crawler.js
*/

import 'dotenv/config';
import { PlaywrightCrawler } from 'crawlee';
import { Client } from '@elastic/elasticsearch';

// Step 1: Set up the Elasticsearch client.
// It uses environment variables defined in your .env file:
//   ES_ENDPOINT (your Elasticsearch endpoint)
//   ES_API_KEY  (your Elasticsearch API key)

const esClient = new Client({
    node: process.env.ES_ENDPOINT,
    auth: {
        apiKey: process.env.ES_API_KEY
    }
});

// Step 2: A helper function to parse or extract data from the page.
function parseData({ pageTitle, pageText, pageUrl }) {
    return {
        title: pageTitle,
        content: pageText,
        url: pageUrl,
        crawledAt: new Date().toISOString()
    };
}

// Step 3: Create a PlaywrightCrawler instance and define its request handler.
const crawler = new PlaywrightCrawler({
    maxConcurrency: 5,
    requestHandler: async ({ request, page, enqueueLinks }) => {
        console.log(`Now processing: ${request.url}`);

        // Extract data from the page
        const pageTitle = await page.title();
        const pageText = await page.textContent('body');
        const pageUrl = request.url;

        // Parse the data into our desired structure
        const documentData = parseData({ pageTitle, pageText, pageUrl });

        // Step 4: Index the data into Elasticsearch
        try {
            await esClient.index({
                index: 'ntu_website',
                document: documentData
            });
            console.log(`Successfully indexed page: ${pageUrl}`);
        } catch (err) {
            console.error(`Error indexing data for: ${pageUrl}`, err);
        }

        // Step 5: Enqueue more links found on the current page
        await enqueueLinks({
            selector: 'a',
            baseUrl: request.loadedUrl
        });
    }
});

// Step 6: Run the crawler with https://www.ntu.edu.tw/ as our starting URL.
async function run() {
    try {
        await crawler.run([
            {
                url: 'https://www.ntu.edu.tw/'
            }
        ]);
        console.log('Crawling complete.');
    } catch (err) {
        console.error('Error starting the crawler:', err);
    }
}

run();
