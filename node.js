import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fetch from 'node-fetch';
import { PlaywrightCrawler } from 'crawlee';
import { Client } from '@elastic/elasticsearch';

// 1. Create Elasticsearch client from environment variables.
//    Make sure you have ES_ENDPOINT and ES_API_KEY set in your .env or environment.
const esClient = new Client({
    node: process.env.ES_ENDPOINT,
    auth: {
        apiKey: process.env.ES_API_KEY
    }
});

// 2. Initialize the GoogleGenerativeAI client.
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

// 3. Generate the custom cleaner function code with LLM.
async function generateCleanerWithGoogleAI(pageHtml) {
    const prompt =
        'You are a helpful coding assistant. Analyze the following HTML and generate ONLY the raw JavaScript code for an async function named getCleanText(page) that, when executed in a Playwright context, performs the following tasks:\n' +
        '- Waits for dynamic content to load (e.g. using page.waitForLoadState).\n' +
        '- Removes extraneous elements such as scripts, styles, iframes, noscript, header, nav, footer, etc., using Playwright APIs (do not use Puppeteer-specific functions like page.$x; instead, use page.locator with XPath selectors and evaluateAll).\n' +
        '- Returns only the main textual content (for example, using document.body.innerText).\n' +
        'DO NOT include any markdown formatting or extra commentary. Output ONLY the function code exactly as it should be defined.\n\nHTML:\n' +
        pageHtml;

    const result = await model.generateContent(prompt);
    let code = result.response.text();

    if (!code) {
        throw new Error('No code was returned by the LLM.');
    }

    // Strip markdown code fences if present.
    code = code.replace(/```/g, '').trim();


    // Remove any leading "javascript" token.
    if (code.toLowerCase().startsWith("javascript")) {
        code = code.replace(/^javascript\s*/i, "");
    }

    console.log('Generated code:', code);
    return code;
}



// 4. Build the crawler by first fetching homepage HTML, then using the LLM code.
async function buildCrawler(websiteUrl, esIndexName) {
    // (A) Fetch homepage HTML for the LLM to analyze.
    const homepageResponse = await fetch(websiteUrl);
    if (!homepageResponse.ok) {
        throw new Error(
            'Failed to fetch homepage. Status: ' + homepageResponse.status
        );
    }
    console.log('Fetching homepage HTML...');

    const homepageHtml = await homepageResponse.text();
    console.log('Homepage fetched, generating cleaner function...');

    // (B) Get the getCleanText function source from the LLM.
    const getCleanTextSource = await generateCleanerWithGoogleAI(homepageHtml);
    console.log('Cleaner function generated.');

    // (C) Dynamically create the getCleanText function from the LLM’s returned code.
    let getCleanText;

    try {
        const wrappedCode = '"use strict"; ' + getCleanTextSource + '; return getCleanText;';
        const buildFunction = new Function(wrappedCode);
        getCleanText = buildFunction();

        if (typeof getCleanText !== 'function') {
            throw new Error('The code did not define a function named getCleanText.');
        }
    } catch (error) {
        throw new Error('Error building function from LLM code: ' + error.message);
    }

    // (D) Create the crawler that uses getCleanText.
    const crawler = new PlaywrightCrawler({
        maxConcurrency: 5,
        requestHandler: async function (context) {
            const request = context.request;
            const page = context.page;
            const enqueueLinks = context.enqueueLinks;

            console.log('Now processing:', request.url);

            // Clean the page content using getCleanText.
            const pageText = await getCleanText(page);
            const pageTitle = await page.title();
            const pageUrl = request.url;

            const documentData = {
                title: pageTitle,
                content: pageText,
                url: pageUrl,
                crawledAt: new Date().toISOString()
            };

            // Index into Elasticsearch using the user-provided index name.
            try {
                await esClient.index({
                    index: esIndexName,
                    document: documentData
                });
                console.log('Successfully indexed page:', pageUrl);
            } catch (error) {
                console.error('Error indexing data for:', pageUrl, error);
            }

            // Enqueue more links.
            await enqueueLinks({
                selector: 'a',
                baseUrl: request.loadedUrl
            });
        }
    });

    return crawler;
}

// 5. Main runner to orchestrate everything.
async function run() {

    const [, , websiteUrl, esIndexName] = process.argv;

    try {
        const crawler = await buildCrawler(websiteUrl, esIndexName);
        await crawler.run([{ url: websiteUrl }]);
        console.log('Crawling complete.');
    } catch (error) {
        console.error('Error in run():', error);
    }
}

run();

