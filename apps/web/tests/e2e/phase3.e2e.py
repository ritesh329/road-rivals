import json, time, sys
from playwright.sync_api import sync_playwright, expect

B="http://localhost:3000"  # run `npm run dev:memory` and the web dev server first
results=[]
def check(name, ok, detail=""):
    results.append((ok,name,detail)); print(("PASS " if ok else "FAIL ")+name+(" — "+detail if detail else ""), flush=True)

with sync_playwright() as p:
    br=p.chromium.launch(args=['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox','--ignore-gpu-blocklist'])
    ctx=br.new_context(viewport={'width':1400,'height':900})
    page=ctx.new_page()
    errs=[]
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.on("console", lambda m: errs.append(m.text) if m.type=="error" and "Failed to load resource" not in m.text else None)

    r=ctx.request.post(B+"/api/auth/register", data={"email":f"e2e{int(time.time())}@t.io","username":f"e2e{int(time.time())%100000}","password":"password123"})
    check("register via proxy sets session", r.status==201)
    ov=ctx.request.get(B+"/api/garage/overview").json()
    own=ov["vehicles"][0]["ownershipId"]

    # ---------- dashboard -> garage
    page.goto(B+"/dashboard"); page.wait_for_selector("text=My Garage")
    link=page.locator("a:has-text('My Garage')")
    check("dashboard: My Garage is a live link", link.count()==1)
    link.click(); page.wait_for_url("**/garage"); page.wait_for_selector("[data-testid=garage-panel]")
    page.wait_for_selector("canvas", timeout=30000)
    time.sleep(3); page.screenshot(path="/tmp/shots/01_garage_home.png")
    check("garage page: 3D preview canvas + panel render", page.locator("canvas").count()>=1)

    # ---------- crash via API then repair via UI
    ctx.request.post(B+"/api/vehicle/damage", data={"ownershipId":own,"impacts":[{"mag":10,"lx":0,"ly":0,"lz":-1}]})
    page.reload(); page.wait_for_selector("[data-testid=garage-panel]"); page.wait_for_selector("[data-testid=health-FRONT_BUMPER]")
    check("repair tab shows persisted damage after reload", "%" in page.locator("[data-testid=health-FRONT_BUMPER]").inner_text() and "100%" not in page.locator("[data-testid=health-FRONT_BUMPER]").inner_text())
    coins_before=int(page.locator("[data-testid=coins]").inner_text().replace("🪙","").replace(",","").strip())
    page.screenshot(path="/tmp/shots/02_repair_damaged.png")
    page.click("[data-testid=repair-MINOR]"); page.wait_for_selector("[data-testid=garage-msg]")
    time.sleep(0.6)
    coins_after=int(page.locator("[data-testid=coins]").inner_text().replace("🪙","").replace(",","").strip())
    check("MINOR repair via button: coins deducted, bumper back to 100%", coins_after<coins_before and "100%" in page.locator("[data-testid=health-FRONT_BUMPER]").inner_text() and "100%" not in page.locator("[data-testid=health-ENGINE]").inner_text(), f"{coins_before}->{coins_after}")
    page.click("[data-testid=repair-FULL]"); time.sleep(0.8)
    check("FULL repair: everything 100%", all("100%" in page.locator(f"[data-testid=health-{c}]").inner_text() for c in ["ENGINE","RADIATOR","DOORS","SUSPENSION"]))

    # ---------- upgrades
    page.click("[data-testid=tab-upgrades]"); page.click("[data-testid=ptype-TYRES]")
    page.screenshot(path="/tmp/shots/03_upgrades.png")
    page.click("[data-testid=buy-tyres-street]"); page.wait_for_selector("text=Bought and installed"); time.sleep(0.6)
    ov=ctx.request.get(B+"/api/garage/overview").json()
    check("buy & install tyres via UI: persisted on server", any(u["partSlug"]=="tyres-street" for u in ov["vehicles"][0]["upgrades"]))
    page.click("[data-testid=ptype-ENGINE]")
    check("engine tiers locked by level show server-matching lock text", page.locator("[data-testid=part-engine-v8]").inner_text().find("needs level 4")>=0)
    page.click("[data-testid=ptype-BRAKES]"); page.click("[data-testid=buy-brakes-sport]"); page.wait_for_selector("text=Bought and installed Sport Pads"); time.sleep(0.6)
    page.click("[data-testid=tab-vehicle]"); time.sleep(0.3)
    stats=page.locator("[data-testid=vehicle-stats]").inner_text()
    page.screenshot(path="/tmp/shots/04_vehicle.png")
    check("vehicle tab lists installed Sport Pads and shows braking distance", "Sport Pads" in page.locator("[data-testid=garage-panel]").inner_text() and "100→0" in stats, stats.replace("\n"," ")[:90])

    # ---------- customize
    page.click("[data-testid=tab-customize]"); page.click("[data-testid=paint-neon-cyan]"); page.click("[data-testid=opt-wheels-mesh]"); page.click("[data-testid=opt-neon-magenta]"); page.click("[data-testid=opt-spoiler-lip]")
    time.sleep(1.2); page.screenshot(path="/tmp/shots/05_customize_preview.png")
    page.click("[data-testid=apply-custom]"); page.wait_for_selector("text=Customization applied"); time.sleep(0.6)
    cfg=ctx.request.get(B+"/api/garage/overview").json()["vehicles"][0]["config"]
    check("customization saved on server", cfg["paint"]=="#22d3ee" and cfg["wheels"]=="mesh" and cfg["neon"]=="magenta" and cfg["spoiler"]=="lip", json.dumps(cfg))
    page.reload(); page.wait_for_selector("[data-testid=garage-panel]"); time.sleep(2.5)
    page.screenshot(path="/tmp/shots/06_customized_after_reload.png")

    # ---------- the game
    me=ctx.request.get(B+"/api/garage/overview").json()
    g=[x for x in me["garages"] if x["kind"]=="WORKSHOP"][0]
    page.goto(B+"/game"); page.wait_for_selector("canvas", timeout=40000); time.sleep(6)
    page.screenshot(path="/tmp/shots/07_game.png")
    check("game loads with debug hook", page.evaluate("typeof window.__RR_DEBUG__")=="object")
    page.evaluate(f"window.__RR_DEBUG__.teleport({g['x']},{g['z']},0)"); time.sleep(3)
    page.screenshot(path="/tmp/shots/08_at_garage.png")
    check("HUD shows garage prompt on the pad", page.locator("text=to open the garage").count()==1)
    page.keyboard.press("KeyE"); page.wait_for_selector("[data-testid=garage-panel]", timeout=15000); time.sleep(1)
    check("E opens the in-world garage (workshop offers all tabs)", all(page.locator(f"[data-testid=tab-{t}]").count()==1 for t in ["repair","upgrades","customize","vehicle"]))
    page.screenshot(path="/tmp/shots/09_world_garage.png")
    page.click("[data-testid=tab-customize]"); page.click("[data-testid=paint-gold]"); time.sleep(1.5)
    page.screenshot(path="/tmp/shots/10_world_preview_gold.png")
    page.keyboard.press("Escape"); time.sleep(0.5)
    check("Esc closes garage", page.locator("[data-testid=garage-panel]").count()==0)

    # ---------- crash in the real physics: teleport near a building and floor it
    page.evaluate("window.__RR_DEBUG__.teleport(0,0,0)"); time.sleep(2)
    d0=page.evaluate("window.__RR_DEBUG__.damage()")
    page.keyboard.down("KeyW")
    hit=False
    for i in range(60):
        time.sleep(1)
        d=page.evaluate("window.__RR_DEBUG__.damage()")
        if d["FRONT_BUMPER"]<95 or d["SUSPENSION"]<95 or d["DOORS"]<95: hit=True; break
    page.keyboard.up("KeyW")
    page.screenshot(path="/tmp/shots/11_after_crash.png")
    d=page.evaluate("window.__RR_DEBUG__.damage()")
    check("driving into the city eventually collides → live damage registered", hit, json.dumps({k:round(v) for k,v in d.items() if v<99}))
    if hit:
        time.sleep(7)  # periodic flush (5s)
        ov=ctx.request.get(B+"/api/garage/overview").json()["vehicles"][0]["damage"]
        check("crash damage was flushed to the server and persisted", any(v<99 for v in ov.values()), json.dumps({k:round(v) for k,v in ov.items() if v<99}))
        check("HUD condition panel visible while damaged", page.locator("[data-testid=hud-condition]").count()==1)
    real=[e for e in errs if "WebGL" not in e and "GPU stall" not in e and "swiftshader" not in e.lower()]
    check("no uncaught page errors", len([e for e in errs if "Error" in e and "WebGL" not in e])==0, "; ".join(real[:3]))
    br.close()
failed=[r for r in results if not r[0]]
print("\nALL PASSED" if not failed else f"\n{len(failed)} FAILED")
sys.exit(1 if failed else 0)
