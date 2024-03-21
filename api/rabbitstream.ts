import supabase from './utils/supabase';
const puppeteer = require('puppeteer-extra');
const chrome = require('@sparticuz/chromium');

// Stealth plugin issue - There is a good fix but currently this works.
require('puppeteer-extra-plugin-user-data-dir')
require('puppeteer-extra-plugin-user-preferences')
require('puppeteer-extra-plugin-stealth/evasions/chrome.app')
require('puppeteer-extra-plugin-stealth/evasions/chrome.csi')
require('puppeteer-extra-plugin-stealth/evasions/chrome.loadTimes')
require('puppeteer-extra-plugin-stealth/evasions/chrome.runtime')
require('puppeteer-extra-plugin-stealth/evasions/defaultArgs') // pkg warned me this one was missing
require('puppeteer-extra-plugin-stealth/evasions/iframe.contentWindow')
require('puppeteer-extra-plugin-stealth/evasions/media.codecs')
require('puppeteer-extra-plugin-stealth/evasions/navigator.hardwareConcurrency')
require('puppeteer-extra-plugin-stealth/evasions/navigator.languages')
require('puppeteer-extra-plugin-stealth/evasions/navigator.permissions')
require('puppeteer-extra-plugin-stealth/evasions/navigator.plugins')
require('puppeteer-extra-plugin-stealth/evasions/navigator.vendor')
require('puppeteer-extra-plugin-stealth/evasions/navigator.webdriver')
require('puppeteer-extra-plugin-stealth/evasions/sourceurl')
require('puppeteer-extra-plugin-stealth/evasions/user-agent-override')
require('puppeteer-extra-plugin-stealth/evasions/webgl.vendor')
require('puppeteer-extra-plugin-stealth/evasions/window.outerdimensions')

const StealthPlugin = require('puppeteer-extra-plugin-stealth')
puppeteer.use(StealthPlugin())

export default async (req: any, res: any) => {
  let {body,method} = req

  // Some header shits
  if (method !== 'POST') {
    res.setHeader('Access-Control-Allow-Credentials', true)
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT')
    res.setHeader(
      'Access-Control-Allow-Headers',
      'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    )
    return res.status(200).end()
  }

  // Some checks...
  if (!body) return res.status(400).end(`No body provided`)
  if (typeof body === 'object' && !body.id) return res.status(400).end(`No url provided`)
  
  const id = body.id;
  const dateConstant = new Date('2024-03-18T10:30:00.000Z');
  const { data: record, error } = await supabase
    .from('streams')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  // router.
  if (error) return res.status(500).end(`Server Error,Check your Id.`);
  else{
    if ((record !== null) && (new Date(record.date_time).getTime() === dateConstant.getTime())){
      return res.json({
        source:record.stream,
        subtitle:record.subtitle,
      });
    }
    else{
      const isProd = process.env.NODE_ENV === 'production'
    
      // create browser based on ENV
      let browser;
      if (isProd) {
        browser = await puppeteer.launch({
          args: chrome.args.concat([
            '--disable-background-networking',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-breakpad',
            '--disable-client-side-phishing-detection',
            '--disable-default-apps',
            '--disable-dev-shm-usage',
            '--disable-extensions',
            '--disable-gesture-typing',
            '--disable-hang-monitor',
            '--disable-infobars',
            '--disable-notifications',
            '--disable-popup-blocking',
            '--disable-prompt-on-repost',
            '--disable-renderer-backgrounding',
            '--disable-speech-api',
            '--disable-sync',
            '--disable-translate',
          ]),
          defaultViewport: chrome.defaultViewport,
          executablePath: await chrome.executablePath(),
          headless: true,
          ignoreHTTPSErrors: true
        })
      } else {
        browser = await puppeteer.launch({
          headless: true,
          executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        })
      }
      const page = await browser.newPage();
      await page.setRequestInterception(true);
      await page.setViewport({
        width: 360,
        height: 640,
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: false,
        isLandscape: false
      });
    
      // Set headers,else wont work.
      await page.setExtraHTTPHeaders({ 'Referer': 'https://flixhq.to/' });
      
      // const logger:string[] = [];
      const finalResponse:{source:string,subtitle:string[]} = {source:'',subtitle:[]}
      
      page.on('request', async (interceptedRequest) => {
        await (async () => {
          // logger.push(interceptedRequest.url());
          if (interceptedRequest.resourceType() === 'stylesheet' || interceptedRequest.resourceType() === 'font') {
            interceptedRequest.abort();
          }
          else{
            if (interceptedRequest.url().includes('.m3u8')) finalResponse.source = interceptedRequest.url();
            if (interceptedRequest.url().includes('.vtt')) finalResponse.subtitle.push(interceptedRequest.url());
            interceptedRequest.continue();
          }
        })();
      });
      
      try {
        const [req] = await Promise.all([
          page.waitForRequest(req => req.url().includes('.m3u8'), { timeout: 20000 }),
          page.goto(`https://rabbitstream.net/v2/embed-4/${id}?z=&_debug=true`, { waitUntil: 'domcontentloaded' }),
        ]);
      } catch (error) {
        await browser.close();
        return res.status(500).end(`Server Error,check the params.`)
      }
      await browser.close();
    
      // Response headers.
      res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate')
      res.setHeader('Content-Type', 'application/json')
      // CORS
      // res.setHeader('Access-Control-Allow-Headers', '*')
      res.setHeader('Access-Control-Allow-Credentials', true)
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT')
      res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
      )
    
      // upsert the data,currently no return cases are checked,but if it works ... then it works ... can fix later ig [TODO] 
      const { error } = await supabase
        .from('streams')
        .upsert([{ id: id, date_time:dateConstant.toISOString() , stream: finalResponse.source, subtitle: finalResponse.subtitle }], { onConflict: ['id'] });
      res.json(finalResponse);
    };
  };
};
