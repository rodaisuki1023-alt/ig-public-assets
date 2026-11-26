#!/usr/bin/env python3
"""Trial-only gateway HTTP QA. No Vercel deploy, no signup, no real photos.
Requires separately approved synthetic A/B/C accounts; no passwords in argv or files.
--self-test performs no network; --run requires explicit confirmation and a real TTY.
This is server HTTP verification, NOT a browser CORS/iPhone/PWA acceptance test.
"""
import base64
import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import time
import urllib.error
import urllib.request
import uuid

BASE = "https://vzyxurodowpjltwbgbyc.supabase.co"
# Publishable key only, same public key as the trial browser config.
KEY = "sb_publishable_26Owk0KT0uV4J0T64QZQyw_wIri_8Ui"
ORIGIN = "https://atokore-v50-owner-review-20261122.vercel.app"
COHORT = "f8a63d1e92"
ITEM = "qa_" + COHORT + "_item"
BUCKET = "atokore-private-photos-v2"
GATE = "/functions/v1/atokore-photo-gateway"
UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
# A small fixed synthetic JPEG, generated from a blank single-pixel image.
JPEG = base64.b64decode(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD5/ooooA//2Q==", validate=True
)

def check(ok, label):
    if not ok:
        raise RuntimeError(label)
    print("PASS", label, flush=True)

def uid(v):
    return isinstance(v, str) and re.fullmatch(UUID, v) is not None

def safe_path(path, hh):
    return isinstance(path, str) and uid(hh) and re.fullmatch(
        re.escape(hh + "/" + ITEM + "/") + UUID + r"\.jpg", path
    ) is not None

def denied(r):
    return r["status"] == 403 and not r["image"] and r["data"].get("error") == "denied"

def direct_denied(r):
    if r["image"]:
        return False
    if r["status"] == 403:
        return True
    evidence = "|".join(str(r["data"].get(k, "")) for k in ("code","error","message","statusCode"))
    return r["status"] in (400,404) and bool(re.search(r"nosuchkey|not.found|object not found|404", evidence, re.I))

def rpc_denied(r):
    return r["status"] == 403 and r["data"].get("code") == "42501"

def image_matches(r):
    return (r["status"] == 200 and r["image"] and
            r["hash"] == hashlib.sha256(JPEG).hexdigest() and
            r["size"] == len(JPEG) and "no-store" in r["cache"].lower())

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def request(path, body=None, token=None):
    # Fixed host and only enumerated paths. Do not forward JWTs on redirects.
    if not (path.startswith("/auth/v1/token?grant_type=password") or
            path.startswith("/rest/v1/rpc/hh_") or path == GATE or
            path.startswith("/storage/v1/object/authenticated/" + BUCKET + "/")):
        raise RuntimeError("request route rejected")
    headers = {"apikey": KEY, "Origin": ORIGIN, "Cache-Control": "no-cache"}
    if token:
        headers["Authorization"] = "Bearer " + token
    if body is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(BASE + path, data=None if body is None else
        json.dumps(body, ensure_ascii=False).encode(), headers=headers,
        method="GET" if body is None else "POST")
    try:
        response = urllib.request.build_opener(NoRedirect()).open(req, timeout=20)
    except urllib.error.HTTPError as exc:
        response = exc
    with response:
        raw = response.read(200001)
        if len(raw) > 200000:
            raise RuntimeError("response too large")
        image = response.headers.get("Content-Type","").lower().startswith("image/jpeg")
        data = {}
        if not image:
            try:
                data = json.loads(raw)
            except (ValueError, UnicodeError):
                pass
        return {"status": response.code, "image": image,
                "hash": hashlib.sha256(raw).hexdigest() if image else None,
                "size": len(raw) if image else 0, "cache": response.headers.get("Cache-Control",""),
                "data": data if isinstance(data, dict) else {}}

def signin(role, password):
    email = "atokore-qa-" + role + "-" + COHORT + "@example.invalid"
    r = request("/auth/v1/token?grant_type=password", {"email": email, "password": password})
    user = r["data"].get("user", {})
    token = r["data"].get("access_token")
    check(r["status"] == 200 and uid(user.get("id")) and user.get("email") == email
          and isinstance(token, str) and bool(token), "synthetic auth " + role)
    return {"id": user["id"], "token": token}

def rpc(user, name, body):
    if name not in ("hh_my","hh_create","hh_invite_create","hh_join","hh_push","hh_pull","hh_remove_member"):
        raise RuntimeError("RPC outside test scope")
    return request("/rest/v1/rpc/" + name, body, user["token"])

def gate(user, body):
    return request(GATE, body, user["token"] if user else None)

def applied(r):
    results = r["data"].get("results", [])
    return r["status"] == 200 and bool(results) and results[0].get("status") == "applied"

def push(user, op):
    return rpc(user, "hh_push", {"p_device": "qa-" + COHORT, "p_ops": [
        {"op_id": str(uuid.uuid4()), "kind": "item", "id": ITEM,
         "ts": int(time.time()*1000), **op}]})

def run():
    if not sys.stdin.isatty() or not sys.stderr.isatty():
        raise RuntimeError("interactive terminal required; never use redirected passwords")
    if input("Type APPROVED-SYNTHETIC-ONLY after approval of this new cohort: ") != "APPROVED-SYNTHETIC-ONLY":
        raise RuntimeError("not authorized; no network")
    passwords = {r:getpass.getpass("Synthetic QA " + r.upper() + " password: ") for r in "abc"}
    if any(len(x)<12 for x in passwords.values()) or len(set(passwords.values()))!=3:
        raise RuntimeError("three different passwords, at least 12 characters; no network")
    marker = Path.home() / (".atokore-photo-qa-once-" + COHORT)
    # Shared cohort with browser QA; additionally the hh_my preflight refuses previously used accounts.
    fd = os.open(marker, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    meta = {"cohort": COHORT, "users": {}, "households": {}, "item": ITEM, "photoPath": None}
    users = {}
    try:
        for role in "abc":
            users[role] = signin(role, passwords[role])
            meta["users"][role] = users[role]["id"]
        for user in users.values():
            r = rpc(user, "hh_my", {})
            check(r["status"]==200 and "household" in r["data"] and r["data"]["household"] is None, "unused cohort preflight")
        a,b,c = (users[k] for k in "abc")
        r = rpc(a,"hh_create",{"p_name":"ATK-QA-"+COHORT+"-A","p_display_name":"QA A"})
        hh = (r["data"].get("household") or {}).get("id")
        check(r["status"]==200 and uid(hh),"create A household")
        meta["households"]["a"] = hh
        inv = rpc(a,"hh_invite_create",{})
        code = inv["data"].get("code")
        check(inv["status"]==200 and isinstance(code,str) and bool(code),"create synthetic invite")
        j = rpc(b,"hh_join",{"p_code":code,"p_display_name":"QA B"})
        check(j["status"]==200 and (j["data"].get("household") or {}).get("id")==hh,"join B")
        r = rpc(c,"hh_create",{"p_name":"ATK-QA-"+COHORT+"-C","p_display_name":"QA C"})
        ch = (r["data"].get("household") or {}).get("id")
        check(r["status"]==200 and uid(ch) and ch!=hh,"create separate C household")
        meta["households"]["c"] = ch
        check(applied(push(a,{"type":"create","qty":2,"fields":{"name":"架空QAおむつ","unit":"袋"}})),"create synthetic item")
        for role,user in (("B",b),("C",c)):
            r=rpc(user,"hh_pull",{"p_since":0,"p_limit":20})
            rows=r["data"].get("records")
            check(r["status"]==200 and isinstance(rows,list) and
                  (any(x.get("id")==ITEM and x.get("qty")==2 for x in rows) if role=="B"
                   else not any(x.get("id")==ITEM for x in rows)),role+" JWT and stock positive control")
        write={"operation":"write","householdId":hh,"recordId":ITEM,"base64":base64.b64encode(JPEG).decode()}
        w=gate(a,write)
        path=w["data"].get("path")
        check(w["status"]==200 and safe_path(path,hh),"A upload")
        meta["photoPath"]=path
        check(applied(push(a,{"type":"set","field":"photoPath","value":path})),"link synthetic item")
        read={"operation":"read","path":path}
        check(image_matches(gate(a,read)),"A SHA256 / no-store")
        check(image_matches(gate(b,read)),"B SHA256 / no-store")
        check(denied(gate(c,read)),"C separate household denied")
        direct="/storage/v1/object/authenticated/"+BUCKET+"/"+path+"?qa=fixed-"+str(uuid.uuid4())
        for role,user in users.items():
            check(direct_denied(request(direct,token=user["token"])),"direct bucket denied "+role)
        noauth=gate(None,read)
        check(noauth["status"] in (401,403) and not noauth["image"],"no auth denied")
        rem=rpc(a,"hh_remove_member",{"p_user":b["id"]})
        check(rem["status"]==200 and rem["data"].get("removed")==1,"remove B")
        check(image_matches(gate(a,read)),"A remains authorized")
        check(denied(gate(b,read)),"same POST / old B JWT denied")
        check(direct_denied(request(direct,token=b["token"])),"same direct URL / B denied")
        check(rpc_denied(rpc(b,"hh_pull",{"p_since":0,"p_limit":20})),"old B stock denied")
        new=signin("b",passwords["b"])
        check(new["id"]==b["id"] and new["token"]!=b["token"],"new B JWT same user")
        check(rpc_denied(rpc(new,"hh_pull",{"p_since":0,"p_limit":20})),"new B stock denied")
        check(denied(gate(new,read)),"same POST / new B JWT denied")
        check(denied(gate(new,{"operation":"delete","path":path})),"removed B delete denied")
        check(denied(gate(new,write)),"removed B upload denied")
        check(image_matches(gate(a,read)),"A image unchanged after denied operations")
        print("HTTP QA PASS; independent log verification and separately approved cleanup still required.")
    finally:
        # Never delete even synthetic data automatically from this terminal.
        # Only identifiers and no secret/token/response body are printed.
        print("SYNTHETIC CLEANUP IDS:", json.dumps(meta,ensure_ascii=False))
        passwords.clear()
        users.clear()

def self_test():
    check(uid("00000000-0000-4000-8000-000000000001"),"valid UUID")
    h="00000000-0000-4000-8000-000000000001"
    p=h+"/"+ITEM+"/00000000-0000-4000-8000-000000000002.jpg"
    check(safe_path(p,h) and not safe_path(p+"\n",h) and not safe_path(p+"?x=1",h)
          and not safe_path(p.replace(ITEM,"other_item"),h),"exact cohort path")
    check(JPEG.startswith(b"\xff\xd8") and JPEG.endswith(b"\xff\xd9") and len(JPEG)<81920,"synthetic bounded JPEG markers")
    good={"status":403,"image":False,"data":{"error":"denied"}}
    check(denied(good) and not denied({**good,"status":401}) and
          not denied({**good,"data":{"error":"origin"}}),"precise access refusal")
    check(direct_denied({**good,"status":400,"data":{"message":"Object not found"}})
          and not direct_denied({**good,"status":400,"data":{"message":"bad request"}}),"precise direct refusal")
    check(image_matches({"status":200,"image":True,"hash":hashlib.sha256(JPEG).hexdigest(),
          "size":len(JPEG),"cache":"private, no-store"}),"exact hash and cache")
    print("SELF-TEST PASS; no network requests made.")

if __name__ == "__main__":
    try:
        if sys.argv[1:] == ["--self-test"]:
            self_test()
        elif sys.argv[1:] == ["--run"]:
            run()
        else:
            print("Use --self-test (offline) or --run (approved synthetic accounts only).")
            sys.exit(2)
    except Exception as exc:
        # Do not echo request headers, response payloads or passwords.
        print("STOP:", type(exc).__name__, str(exc) if type(exc) is RuntimeError else "check terminal/test setup", file=sys.stderr)
        sys.exit(1)
