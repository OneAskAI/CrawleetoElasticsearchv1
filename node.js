/*
NTU-Crawlee-ES-Integration with ENV-based Elasticsearch configuration and content cleaning

This updated code:
1. Uses Crawlee (PlaywrightCrawler) to crawl https://www.ntu.edu.tw/
2. Removes inline scripts, styles, and other undesired text (like Alpine.js code)
3. Indexes the cleaned text into Elasticsearch.
4. Reads the ES endpoint and API key from your .env file.

Instructions:
1. Have Node.js installed.
2. Run: npm install crawlee @elastic/elasticsearch dotenv
3. Create a .env file with:
   ES_ENDPOINT="<your-elasticsearch-endpoint>"
   ES_API_KEY="<your-elasticsearch-api-key>"
4. Save this file (e.g., ntu-crawler.js)
5. Run with: node ntu-crawler.js
*/

import 'dotenv/config';
import { PlaywrightCrawler } from 'crawlee';
import { Client } from '@elastic/elasticsearch';

// Step 1: Set up the Elasticsearch client.
const esClient = new Client({
    node: process.env.ES_ENDPOINT,
    auth: {
        apiKey: process.env.ES_API_KEY
    }
});

// Step 2: A helper function to parse or extract data from the page.
// We'll do some minimal cleanup, removing script and style elements before we extract the text.
async function getCleanText(page) {
    // Remove <script> and <style> elements from DOM to avoid inline JS code.
    await page.evaluate(() => {
        const elements = document.querySelectorAll('script, style');
        elements.forEach((el) => el.remove());
    });

    // Now, get the text of the body.
    let bodyText = await page.textContent('body');
    if (!bodyText) {
        return '';
    }

    // Additional optional cleanup can go here.
    // For example, removing multiple line breaks, excessive whitespace, etc.
    // bodyText = bodyText.replace(/\s+/g, ' ').trim();

    return bodyText;
}

function parseData({ pageTitle, pageText, pageUrl }) {
    return {
        title: pageTitle,
        content: pageText,
        url: pageUrl,
        crawledAt: new Date().toISOString()
    };
}

// Step 3: Create the PlaywrightCrawler
const crawler = new PlaywrightCrawler({
    maxConcurrency: 5,
    requestHandler: async ({ request, page, enqueueLinks }) => {
        console.log(`Now processing: ${request.url}`);

        // Clean up the page before extracting text
        const pageText = await getCleanText(page);
        const pageTitle = await page.title();
        const pageUrl = request.url;

        // Build the data object to store in ES
        const documentData = parseData({ pageTitle, pageText, pageUrl });

        // Step 4: Index the cleaned data into Elasticsearch
        try {
            await esClient.index({
                index: 'ntu_website',
                document: documentData
            });
            console.log(`Successfully indexed page: ${pageUrl}`);
        } catch (err) {
            console.error(`Error indexing data for: ${pageUrl}`, err);
        }

        // Step 5: Enqueue more links found on the page
        await enqueueLinks({
            selector: 'a',
            baseUrl: request.loadedUrl
        });
    }
});

// Step 6: Run the crawler
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
