import json, time, sys, re
from playwright.sync_api import sync_playwright

B="http://localhost:3000"
results=[]
def check(name, ok, detail=""):
    results.append(ok); print(("PASS " if ok else "FAIL ")+name+(" — "+detail if detail else ""), flush=True)

u=int(time.time())
LOW='localStorage.setItem("rr.settings.v1", JSON.stringify({quality:"low",minimap:true,night:false,camera:"chase",sound:false,touch:false}))'
with sync_playwright() as p:
    br=p.chromium.launch(args=['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox','--ignore-gpu-blocklist'])
    def newuser(name, via_ui=False):
        ctx=br.new_context(viewport={'width':1100,'height':700}); ctx.add_init_script(LOW)
        page=ctx.new_page(); errs=[]
        page.on("pageerror", lambda e: errs.append(str(e)))
        uname=f"{name}{u%10000}"
        if not via_ui:
            r=ctx.request.post(B+"/api/auth/register", data={"email":f"{uname}@t.io","username":uname,"password":"password123"}); assert r.status==201, r.text()
        return dict(ctx=ctx,page=page,name=uname,errs=errs)
    A=newuser("alpha")
    A["page"].goto(B+"/dashboard"); A["page"].wait_for_selector("text=Create Room")
    A["page"].click("a:has-text('Create Room')"); A["page"].wait_for_url("**/rooms")
    A["page"].click("[data-testid=vis-PUBLIC]"); A["page"].click("[data-testid=create-room]")
    A["page"].wait_for_url(re.compile(r".*/room/[A-Z0-9]{6}$")); A["page"].wait_for_selector("[data-testid=room-code]")
    code=A["page"].inner_text("[data-testid=room-code]").strip(); link=A["page"].input_value("[data-testid=invite-link]")
    check("host creates a room from the dashboard; lobby shows code + invite link", re.fullmatch(r"[A-Z2-9]{6}",code) and "/join/" in link, f"{code} {link[-12:]}")
    A["page"].screenshot(path="/tmp/shots/mp01_lobby_host.png")

    # --- B: brand-new visitor opens the invite link logged-out -> login/register -> lands in THE room
    Bu=newuser("bravo", via_ui=True); pg=Bu["page"]
    pg.goto(link); pg.wait_for_selector("[data-testid=join-card]"); pg.wait_for_selector("text=Create account")
    check("logged-out invite page shows the host's name and offers login/register", A["name"] in pg.inner_text("[data-testid=join-card]"))
    pg.click("text=Create account"); pg.wait_for_selector("input[placeholder=Username]")
    pg.fill("input[type=email]", f"{Bu['name']}@t.io"); pg.fill("input[placeholder=Username]", Bu["name"]); pg.fill("input[type=password]", "password123"); pg.click("button:has-text('Register')")
    pg.wait_for_url(re.compile(r".*/room/"+code+"$"), timeout=30000); pg.wait_for_selector("[data-testid=member-row]")
    check("after registering, the invite link put B into the CORRECT room", pg.inner_text("[data-testid=room-code]").strip()==code)
    A["page"].wait_for_function("document.querySelectorAll('[data-testid=member-row]').length===2", timeout=10000)
    check("host's lobby updated LIVE (no reload): 2 players", "2/5" in A["page"].inner_text("[data-testid=room-count]"))

    # --- C, D, E join by invite (logged in) -> 5/5
    others=[]
    for nm in ["charlie","delta","echo"]:
        o=newuser(nm); o["page"].goto(link); o["page"].wait_for_url(re.compile(r".*/room/"+code+"$"), timeout=30000); o["page"].wait_for_selector("[data-testid=member-row]"); others.append(o)
    A["page"].wait_for_function("document.querySelectorAll('[data-testid=member-row]').length===5", timeout=10000)
    check("5 players in the lobby, everyone sees 5/5 live", all("5/5" in x["page"].inner_text("[data-testid=room-count]") for x in [A,Bu]+others))
    F=newuser("foxtrot"); F["page"].goto(link); F["page"].wait_for_selector("text=Room is full", timeout=15000)
    check("a 6th player opening the link sees 'Room is full' and the join button is disabled", F["page"].locator("[data-testid=join-invite]").is_disabled() and "/room/" not in F["page"].url)

    # lobby chat
    Bu["page"].fill("[data-testid=lobby-chat-input]", "hello from bravo"); Bu["page"].press("[data-testid=lobby-chat-input]", "Enter")
    A["page"].wait_for_selector("[data-testid=lobby-chat] >> text=hello from bravo", timeout=8000)
    check("lobby chat delivered live to the host", True)
    A["page"].screenshot(path="/tmp/shots/mp02_lobby_full.png")

    # ready + start
    A["page"].click("[data-testid=start]"); A["page"].wait_for_selector("[data-testid=room-note]")
    check("start is refused until everybody is ready", "ready" in A["page"].inner_text("[data-testid=room-note]").lower())
    for x in [Bu]+others: x["page"].click("[data-testid=ready]")
    A["page"].wait_for_function("document.body.innerText.includes('Start session')", timeout=8000)
    A["page"].click("[data-testid=start]")
    allp=[A,Bu]+others
    for x in allp: x["page"].wait_for_url(re.compile(r".*/game\?room="+code), timeout=30000)
    check("all 5 browsers got the countdown and navigated into the shared world", True)
    for x in allp: x["page"].wait_for_selector("canvas", timeout=60000)
    for x in allp: x["page"].wait_for_function("window.__RR_DEBUG__ && window.__RR_DEBUG__.netPlayers()===4", timeout=90000)
    check("every browser sees the 4 OTHER players in the 3D world", True)
    time.sleep(4); A["page"].screenshot(path="/tmp/shots/mp03_game_A.png")
    check("name tags rendered for the other drivers", A["page"].locator("[data-testid=nametag]").count()>=4, str(A["page"].locator("[data-testid=nametag]").count()))
    check("players panel shows 4 rows", A["page"].locator("[data-testid=player-row]").count()==4)

    # movement sync
    a0=A["page"].evaluate("window.__RR_DEBUG__.pos()")
    A["page"].keyboard.down("KeyW"); time.sleep(5); A["page"].keyboard.up("KeyW")
    a1=A["page"].evaluate("window.__RR_DEBUG__.pos()")
    moved=((a1['x']-a0['x'])**2+(a1['z']-a0['z'])**2)**.5
    time.sleep(1.5)
    seen=None
    for r in Bu["page"].evaluate("window.__RR_DEBUG__.remotes()"):
        d=((r['x']-a1['x'])**2+(r['z']-a1['z'])**2)**.5
        if seen is None or d<seen: seen=d
    check("B's screen shows A's car at (nearly) the same place as A's own screen", seen is not None and seen<8, f"A moved {moved:.1f} m, B's nearest remote is {seen if seen is None else round(seen,1)} m from A")

    # chat in game
    A["page"].keyboard.press("KeyT"); A["page"].fill("[data-testid=chat-input]", "gg in game"); A["page"].keyboard.press("Enter")
    others[0]["page"].wait_for_selector("[data-testid=chat] >> text=gg in game", timeout=8000)
    check("in-game chat (T) reaches the other players", True)

    # car-to-car collision: put A right behind stationary B on the same lane and floor it
    bpos=Bu["page"].evaluate("window.__RR_DEBUG__.pos()")
    A["page"].evaluate(f"window.__RR_DEBUG__.teleport({bpos['x']-26},{bpos['z']},{1.5708})"); time.sleep(3)
    d0=A["page"].evaluate("window.__RR_DEBUG__.damage()")
    A["page"].keyboard.down("KeyW"); hit=False
    for i in range(30):
        time.sleep(1); d=A["page"].evaluate("window.__RR_DEBUG__.damage()")
        if d["FRONT_BUMPER"]<d0["FRONT_BUMPER"]-3: hit=True; break
    A["page"].keyboard.up("KeyW")
    check("ramming B's car: A takes real collision damage (cars are solid to each other)", hit, f"bumper {d0['FRONT_BUMPER']:.0f} -> {d['FRONT_BUMPER']:.0f}")
    A["page"].screenshot(path="/tmp/shots/mp04_collision.png")
    time.sleep(1.0)  # let everything settle (A released W)
    a1=A["page"].evaluate("window.__RR_DEBUG__.pos()"); rem=Bu["page"].evaluate("window.__RR_DEBUG__.remotes()"); a2=A["page"].evaluate("window.__RR_DEBUG__.pos()")
    travelled=((a2['x']-(bpos['x']-26))**2+(a2['z']-bpos['z'])**2)**.5
    sv=min(((r['x']-a['x'])**2+(r['z']-a['z'])**2)**.5 for r in rem for a in (a1,a2))
    check("A drove up to the cars ahead; B's view of A matches A's real position", travelled>5 and sv<8, f"A travelled {travelled:.1f} m, B sees A within {sv:.1f} m")

    # someone leaves
    others[2]["page"].goto(B+"/dashboard"); time.sleep(2)
    A["page"].wait_for_function("window.__RR_DEBUG__.netPlayers()===3", timeout=20000)
    check("when a player leaves, the others drop their car immediately (3 remote cars left)", True)
    errs=[e for x in allp for e in x["errs"] if "WebGL" not in e]
    check("no uncaught page errors in any of the 5 browsers", len(errs)==0, "; ".join(errs[:2]))
    br.close()
print("\nALL PASSED" if all(results) else f"\n{results.count(False)} FAILED"); sys.exit(0 if all(results) else 1)
