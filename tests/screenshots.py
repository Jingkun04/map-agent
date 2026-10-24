"""Headless screenshots of a built-in world (needs Playwright and local three.js).
Usage: npm run screenshots -- [preset index 0-3]"""
import asyncio, time, sys
from playwright.async_api import async_playwright
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
THREE = (ROOT / 'node_modules/three/build/three.min.js').read_bytes()  # npm install (three@0.128.0)
OUT = ROOT / 'docs/screenshots'
PRESET = int(sys.argv[1]) if len(sys.argv) > 1 else 0
if PRESET not in range(4):
    raise SystemExit('preset index must be 0, 1, 2, or 3')
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        pg = await b.new_page(viewport={'width':1600,'height':1300})
        errs=[]
        pg.on('pageerror', lambda e: errs.append('ERR '+str(e)))
        pg.on('console', lambda m: errs.append(m.type+': '+m.text) if m.type in ('error','warning') and 'ERR_FAILED' not in m.text else None)
        await pg.route('**/fonts.googleapis.com/**', lambda r: r.abort())
        await pg.route('**/three.min.js', lambda r: r.fulfill(body=THREE, content_type='application/javascript'))
        t=time.time()
        await pg.goto((ROOT / 'dist/region-map-agent.html').as_uri())
        idle = 'document.querySelectorAll("#scrub button").length >= 1 && !document.querySelector("#run").disabled && curSnap() && plansReady(curSnap().W)'
        if PRESET != 0:
            await pg.wait_for_function(idle, timeout=120000)
            await pg.evaluate('(index) => { document.querySelector("#desc").value = PRESETS[index].text; }', PRESET)
            await pg.click('#run')
        await pg.wait_for_function(idle, timeout=120000); print('ready', round(time.time()-t,1)); await pg.wait_for_timeout(9000)
        box = await (await pg.query_selector('.canvasbox')).bounding_box(); await pg.screenshot(path=OUT / f'preset{PRESET}_3d.png', clip=box)
        city = await pg.evaluate('S.city'); print('city', city)
        await pg.evaluate('flyTo(S.city)'); await pg.wait_for_timeout(15000)
        await pg.screenshot(path=OUT / f'preset{PRESET}_fly.png', clip=box)
        await pg.evaluate('V3.ctl.phi = 0.5; V3.ctl.theta = 0.9; V3.ctl.radius = 110; V3.dirty = true'); await pg.wait_for_timeout(9000)
        await pg.screenshot(path=OUT / f'preset{PRESET}_close.png', clip=box)
        await (await pg.query_selector('.city-panel')).screenshot(path=OUT / f'preset{PRESET}_panel.png')
        await pg.click('[data-view="2d"]'); await pg.wait_for_timeout(1200)
        await (await pg.query_selector('.canvasbox')).screenshot(path=OUT / f'preset{PRESET}_2d.png')
        print('\n'.join(errs[:20]) or 'no errors')
        await b.close()
asyncio.run(main())
