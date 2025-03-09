/*
NTU-Crawlee-ES-Integration with ENV-based Elasticsearch configuration and extended content cleaning

This version:
1. Uses Crawlee (PlaywrightCrawler) to crawl https://www.ntu.edu.tw/
2. Removes a broad set of non-essential elements (scripts, styles, iframes, nav, header, footer, etc.)
3. Indexes the minimal textual content of each page into Elasticsearch
4. Reads ES endpoint and API key from a .env file

Usage:
1. npm install crawlee @elastic/elasticsearch dotenv
2. Create a .env with:
   ES_ENDPOINT="<your-elasticsearch-endpoint>"
   ES_API_KEY="<your-elasticsearch-api-key>"
3. Save as ntu-crawler.js, run: node ntu-crawler.js
*/

import 'dotenv/config';
import { PlaywrightCrawler } from 'crawlee';
import { Client } from '@elastic/elasticsearch';

// 1. Elasticsearch client
const esClient = new Client({
    node: process.env.ES_ENDPOINT,
    auth: {
        apiKey: process.env.ES_API_KEY
    }
});

// 2. Remove extraneous elements to keep only main content
async function getCleanText(page) {
    // We remove scripts, styles, iframes, nav, header, footer, aside, etc.
    await page.evaluate(() => {
        const tagsToRemove = [
            'script', 'style', 'iframe', 'nav', 'header', 'footer', 'aside',
            'noscript', 'form', 'link', 'meta', 'button', 'input'
        ];
        tagsToRemove.forEach(tag => {
            document.querySelectorAll(tag).forEach(el => el.remove());
        });
    });

    // Extract text from <body>
    let bodyText = await page.textContent('body');
    if (!bodyText) {
        return '';
    }

    // Condense whitespace
    bodyText = bodyText.replace(/\s+/g, ' ').trim();

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

// 3. Create the PlaywrightCrawler
const crawler = new PlaywrightCrawler({
    maxConcurrency: 5,
    requestHandler: async ({ request, page, enqueueLinks }) => {
        console.log(`Now processing: ${request.url}`);

        // Clean up the page
        const pageText = await getCleanText(page);
        const pageTitle = await page.title();
        const pageUrl = request.url;

        // Build document to store
        const documentData = parseData({ pageTitle, pageText, pageUrl });

        // 4. Index in Elasticsearch
        try {
            await esClient.index({
                index: 'ntu_website',
                document: documentData
            });
            console.log(`Successfully indexed page: ${pageUrl}`);
        } catch (err) {
            console.error(`Error indexing data for: ${pageUrl}`, err);
        }

        // 5. Enqueue more links from the page
        await enqueueLinks({
            selector: 'a',
            baseUrl: request.loadedUrl
        });
    }
});

// 6. Run the crawler
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
