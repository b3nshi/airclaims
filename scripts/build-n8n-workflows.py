#!/usr/bin/env python3
"""Builds the importable n8n workflow exports in /n8n from the sources in /n8n/src.

    python3 scripts/build-n8n-workflows.py

Edit the JavaScript / prompt in n8n/src, re-run, re-import. Node ids are deterministic so
re-builds produce small diffs.

Configuration without n8n environment variables (works on the free self-hosted edition):
  * secrets live in n8n credentials (encrypted, instance-wide) - see CREDENTIALS below;
  * other settings live in the `airclaim-config` workflow, loaded by every workflow through
    an Execute Workflow node named "Load config";
  * webhook signatures are verified by Supabase (verify_webhook_signature, Vault secret).
"""
import json
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "n8n" / "src"
OUT = ROOT / "n8n"

CREDENTIALS = {
    "supabase": ("httpCustomAuth", "AirClaims Supabase (service role)"),
    "aerodatabox": ("httpHeaderAuth", "AeroDataBox (RapidAPI key)"),
    "anthropic": ("httpHeaderAuth", "Anthropic API key"),
    "forwardemail": ("httpBasicAuth", "Forward Email API"),
}

# Non-secret settings, edited in n8n in the `airclaim-config` workflow after import.
SETTINGS = {
    "supabase_url": "https://YOUR-PROJECT-REF.supabase.co",
    "app_url": "https://airclaims.klivr.com",
    "notify_from": "AirClaims <no-reply@airclaims.klivr.com>",
    "forwardemail_api_url": "https://api.forwardemail.net/v1/emails",
    "anthropic_model": "claude-opus-5-5",
    "anthropic_effort": "medium",
    "flight_check_batch": 5,
    "email_send_batch": 5,
}

CFG = "$('Load config').first().json"


def src(path: str) -> str:
    return (SRC / path).read_text().rstrip() + "\n"


class Workflow:
    def __init__(self, name: str):
        self.name, self.nodes, self.edges = name, [], []

    def _id(self, node_name: str) -> str:
        return str(uuid.uuid5(uuid.NAMESPACE_URL, f"airclaims/{self.name}/{node_name}"))

    def add(self, name, type_, version, pos, parameters, **extra):
        node = {"id": self._id(name), "name": name, "type": type_, "typeVersion": version,
                "position": pos, "parameters": parameters, **extra}
        self.nodes.append(node)
        return name

    def link(self, a, b, output=0):
        self.edges.append((a, output, b))

    def chain(self, *names):
        for a, b in zip(names, names[1:]):
            self.link(a, b)

    # ---- node helpers -------------------------------------------------------------------
    def webhook(self, path, pos):
        return self.add("Webhook", "n8n-nodes-base.webhook", 2, pos,
                        {"httpMethod": "POST", "path": path, "responseMode": "responseNode",
                         "options": {"rawBody": True}},
                        webhookId=self._id("webhook-id"))

    def schedule(self, name, minutes, pos):
        return self.add(name, "n8n-nodes-base.scheduleTrigger", 1.2, pos,
                        {"rule": {"interval": [{"field": "minutes", "minutesInterval": minutes}]}})

    def code(self, name, js, pos, each=False):
        params = {"jsCode": js}
        if each:
            params["mode"] = "runOnceForEachItem"
        return self.add(name, "n8n-nodes-base.code", 2, pos, params)

    def load_config(self, pos):
        return self.add("Load config", "n8n-nodes-base.executeWorkflow", 1.2, pos,
                        {"source": "database", "mode": "once",
                         "workflowId": {"__rl": True, "mode": "list", "value": "",
                                        "cachedResultName": "airclaim-config"},
                         "options": {}})

    def if_(self, name, expr, operator, pos, right=""):
        return self.add(name, "n8n-nodes-base.if", 2, pos, {
            "conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose"},
                           "conditions": [{"id": self._id(name + "/c"), "leftValue": expr,
                                           "rightValue": right, "operator": operator}],
                           "combinator": "and"},
            "options": {}})

    def respond(self, name, body, code_, pos):
        return self.add(name, "n8n-nodes-base.respondToWebhook", 1.1, pos,
                        {"respondWith": "json", "responseBody": body, "options": {"responseCode": code_}})

    def http(self, name, pos, *, url, credential, method="POST", body=None, headers=None,
             query=None, full_response=False, timeout=None, batch_interval=None, continue_on_error=False):
        cred_type, cred_name = CREDENTIALS[credential]
        params = {"method": method, "url": url,
                  "authentication": "genericCredentialType", "genericAuthType": cred_type}
        if query:
            params.update(sendQuery=True, queryParameters={"parameters": [{"name": k, "value": v} for k, v in query]})
        if headers:
            params.update(sendHeaders=True, headerParameters={"parameters": [{"name": k, "value": v} for k, v in headers]})
        if body is not None:
            params.update(sendBody=True, specifyBody="json", jsonBody=body)
        options = {}
        if full_response:
            options["response"] = {"response": {"fullResponse": True, "neverError": True}}
        if timeout:
            options["timeout"] = timeout
        if batch_interval:
            options["batching"] = {"batch": {"batchSize": 1, "batchInterval": batch_interval}}
        params["options"] = options
        extra = {"credentials": {cred_type: {"id": "", "name": cred_name}}}
        if continue_on_error:
            extra["onError"] = "continueRegularOutput"
        return self.add(name, "n8n-nodes-base.httpRequest", 4.2, pos, params, **extra)

    def rpc(self, name, fn, body, pos, **kw):
        return self.http(name, pos, url=f"={{{{ {CFG}.supabase_url }}}}/rest/v1/rpc/{fn}",
                         credential="supabase", body=body, **kw)

    def signed_entry(self, path, pos, verify_next):
        """Webhook → Read request → Load config → Verify signature (in Supabase)."""
        self.webhook(path, [pos[0], pos[1]])
        self.code("Read request", src("common/read-request.js"), [pos[0] + 200, pos[1]])
        self.load_config([pos[0] + 400, pos[1]])
        self.rpc("Verify signature", "verify_webhook_signature",
                 "={{ JSON.stringify({ p_timestamp: $('Read request').first().json.timestamp, "
                 "p_body: $('Read request').first().json.raw, "
                 "p_signature: $('Read request').first().json.signature }) }}",
                 [pos[0] + 800, pos[1]])
        self.chain("Webhook", "Read request", "Load config")
        self.link("Verify signature", verify_next)

    def export(self):
        names = {n["name"] for n in self.nodes}
        connections = {}
        for a, idx, b in self.edges:
            assert a in names and b in names, (self.name, a, b)
            outs = connections.setdefault(a, {"main": []})["main"]
            while len(outs) <= idx:
                outs.append([])
            outs[idx].append({"node": b, "type": "main", "index": 0})
        wf = {"name": self.name, "nodes": self.nodes, "connections": connections,
              "settings": {"executionOrder": "v1", "saveDataSuccessExecution": "none"}, "active": False}
        (OUT / f"{self.name}.json").write_text(json.dumps(wf, indent=2, ensure_ascii=False) + "\n")


TRUE = {"type": "boolean", "operation": "true", "singleValue": True}
EXISTS = {"type": "string", "operation": "exists", "singleValue": True}
FROM_WEBHOOK = "={{ $('Read request').isExecuted }}"


# ---- airclaim-config ----------------------------------------------------------------------
def config():
    wf = Workflow("airclaim-config")
    wf.add("When called", "n8n-nodes-base.executeWorkflowTrigger", 1.1, [0, 0], {"inputSource": "passthrough"})
    wf.add("Settings", "n8n-nodes-base.set", 3.4, [220, 0],
           {"mode": "raw", "jsonOutput": json.dumps(SETTINGS, indent=2), "options": {}})
    wf.chain("When called", "Settings")
    wf.export()


# ---- airclaim-flight-check ----------------------------------------------------------------
def flight_check():
    wf = Workflow("airclaim-flight-check")
    wf.signed_entry("airclaim-flight-check", [0, 300], "Valid?")
    wf.schedule("Every 10 minutes", 10, [200, 100])
    wf.link("Every 10 minutes", "Load config")
    wf.if_("From webhook?", FROM_WEBHOOK, TRUE, [600, 300])
    wf.link("Load config", "From webhook?")
    wf.link("From webhook?", "Verify signature", 0)
    wf.link("From webhook?", "Claim due checks", 1)
    wf.if_("Valid?", "={{ $json.valid }}", TRUE, [1000, 300])
    wf.respond("Accepted", '={{ { "accepted": true } }}', 202, [1200, 240])
    wf.respond("Reject", '={{ { "error": "invalid_signature" } }}', 401, [1200, 400])
    wf.link("Valid?", "Accepted", 0)
    wf.link("Valid?", "Reject", 1)
    # Cache first (0007): only flights with no final data in `flights` are leased.
    wf.rpc("Claim due checks", "claim_due_flight_checks",
           f"={{{{ JSON.stringify({{ p_limit: {CFG}.flight_check_batch }}) }}}}", [1400, 120])
    wf.link("Accepted", "Claim due checks")
    wf.if_("Has check?", "={{ $json.id }}", EXISTS, [1600, 120])
    wf.http("AeroDataBox", [1800, 120], method="GET", credential="aerodatabox",
            url="=https://aerodatabox.p.rapidapi.com/flights/number/{{ $json.flight_iata }}/{{ $json.flight_date }}",
            query=[("withAircraftImage", "false"), ("withLocation", "false"), ("dateLocalRole", "Departure")],
            headers=[("X-RapidAPI-Host", "aerodatabox.p.rapidapi.com")],
            full_response=True, timeout=10000, batch_interval=1100)
    wf.code("Normalize", src("flight-check/normalize.js"), [2000, 120], each=True)
    wf.if_("Got data?", "={{ $json.outcome }}", {"type": "string", "operation": "notEquals"}, [2200, 120], "error")
    wf.rpc("Complete check", "complete_flight_check",
           "={{ JSON.stringify({ p_check_id: $json.check_id, p_found: $json.outcome === 'found', "
           "p_flight: $json.flight ?? null, p_raw: $json.raw ?? null }) }}", [2400, 40])
    wf.rpc("Fail check", "fail_flight_check",
           "={{ JSON.stringify({ p_check_id: $json.check_id, p_error: $json.error }) }}", [2400, 220])
    wf.chain("Claim due checks", "Has check?", "AeroDataBox", "Normalize", "Got data?")
    wf.link("Got data?", "Complete check", 0)
    wf.link("Got data?", "Fail check", 1)
    wf.export()


# ---- airclaim-email-draft -----------------------------------------------------------------
def email_draft():
    wf = Workflow("airclaim-email-draft")
    wf.signed_entry("airclaim-email-draft", [0, 300], "Parse request")
    wf.link("Load config", "Verify signature")
    wf.code("Parse request", src("email-draft/parse-request.js"), [1000, 300])
    wf.if_("Valid?", "={{ $json.valid }}", TRUE, [1200, 300])
    wf.respond("Accepted", '={{ { "accepted": true } }}', 202, [1400, 240])
    wf.respond("Reject", '={{ { "error": "invalid_signature_or_input" } }}', 401, [1400, 400])
    wf.link("Parse request", "Valid?")
    wf.link("Valid?", "Accepted", 0)
    wf.link("Valid?", "Reject", 1)
    wf.rpc("Claim idempotency key", "claim_webhook_key",
           "={{ JSON.stringify({ p_key: $('Parse request').first().json.idempotency_key, "
           "p_workflow: 'airclaim-email-draft' }) }}", [1600, 240])
    wf.if_("First time?", "={{ $json.claimed }}", TRUE, [1800, 240])
    wf.rpc("Claim context", "email_draft_context",
           "={{ JSON.stringify({ p_claim_id: $('Parse request').first().json.claim_id, "
           "p_template: $('Parse request').first().json.template }) }}", [2000, 160])
    wf.if_("Eligible?", "={{ $json.ok }}", TRUE, [2200, 160])
    prompt = src("email-draft/system-prompt.md").rstrip("\n")
    wf.code("Build request", src("email-draft/build-request.js").replace("__SYSTEM_PROMPT__", json.dumps(prompt)), [2400, 80])
    wf.http("Claude", [2600, 80], url="https://api.anthropic.com/v1/messages", credential="anthropic",
            headers=[("anthropic-version", "2023-06-01"), ("anthropic-beta", "server-side-fallback-2026-07-01")],
            body="={{ JSON.stringify($json.request) }}", full_response=True, timeout=180000)
    wf.code("Check draft", src("email-draft/check-draft.js"), [2800, 80])
    wf.if_("Draft ok?", "={{ $json.ok }}", TRUE, [3000, 80])
    wf.rpc("Save draft", "insert_email_draft",
           "={{ JSON.stringify({ p_claim_id: $json.claim_id, p_template: $json.template, "
           "p_subject: $json.subject, p_body: $json.body }) }}", [3200, 0])
    wf.code("Notification", src("common/notification-texts.js") + src("email-draft/notification.js"), [3400, 0])
    wf.http("Notify user", [3600, 0], url=f"={{{{ {CFG}.forwardemail_api_url }}}}", credential="forwardemail",
            body="={{ JSON.stringify($json) }}", continue_on_error=True)
    wf.rpc("Log failure", "log_claim_event",
           "={{ JSON.stringify({ p_claim_id: $json.claim_id, p_event_type: 'email_draft_failed', "
           "p_payload: { template: $json.template, error: $json.error } }) }}", [3200, 200], continue_on_error=True)
    wf.rpc("Release key (failed)", "release_webhook_key",
           "={{ JSON.stringify({ p_key: $('Check draft').first().json.idempotency_key }) }}", [3400, 200],
           continue_on_error=True)
    wf.rpc("Release key (not eligible)", "release_webhook_key",
           "={{ JSON.stringify({ p_key: $('Parse request').first().json.idempotency_key }) }}", [2400, 280],
           continue_on_error=True)
    wf.chain("Accepted", "Claim idempotency key", "First time?")
    wf.link("First time?", "Claim context", 0)
    wf.link("Claim context", "Eligible?")
    wf.link("Eligible?", "Build request", 0)
    wf.link("Eligible?", "Release key (not eligible)", 1)
    wf.chain("Build request", "Claude", "Check draft", "Draft ok?")
    wf.link("Draft ok?", "Save draft", 0)
    wf.link("Draft ok?", "Log failure", 1)
    wf.chain("Log failure", "Release key (failed)")
    wf.chain("Save draft", "Notification", "Notify user")
    wf.export()


# ---- airclaim-email-send ------------------------------------------------------------------
def email_send():
    wf = Workflow("airclaim-email-send")
    wf.signed_entry("airclaim-email-send", [0, 300], "Valid?")
    wf.schedule("Every 5 minutes", 5, [200, 100])
    wf.link("Every 5 minutes", "Load config")
    wf.if_("From webhook?", FROM_WEBHOOK, TRUE, [600, 300])
    wf.link("Load config", "From webhook?")
    wf.link("From webhook?", "Verify signature", 0)
    wf.link("From webhook?", "Lease approved emails", 1)
    wf.if_("Valid?", "={{ $json.valid }}", TRUE, [1000, 300])
    wf.respond("Accepted", '={{ { "accepted": true } }}', 202, [1200, 240])
    wf.respond("Reject", '={{ { "error": "invalid_signature" } }}', 401, [1200, 400])
    wf.link("Valid?", "Accepted", 0)
    wf.link("Valid?", "Reject", 1)
    wf.rpc("Lease approved emails", "claim_approved_emails",
           f"={{{{ JSON.stringify({{ p_limit: {CFG}.email_send_batch }}) }}}}", [1400, 120])
    wf.link("Accepted", "Lease approved emails")
    wf.if_("Has email?", "={{ $json.id }}", EXISTS, [1600, 120])
    # One call per email signs all its attachment paths (full response keeps it one item).
    wf.http("Sign attachment URLs", [1800, 120], credential="supabase",
            url=f"={{{{ {CFG}.supabase_url }}}}/storage/v1/object/sign/claim-documents",
            body="={{ JSON.stringify({ expiresIn: 300, paths: ($json.attachments || []).map(a => a.storage_path) }) }}",
            full_response=True)
    wf.code("Build message", src("email-send/build-message.js"), [2000, 120], each=True)
    wf.if_("Ready?", "={{ $json.ready }}", TRUE, [2200, 120])
    wf.http("Send via Forward Email", [2400, 40], url=f"={{{{ {CFG}.forwardemail_api_url }}}}",
            credential="forwardemail", body="={{ JSON.stringify($json.payload) }}", full_response=True, timeout=60000)
    wf.code("Result", src("email-send/result.js"), [2600, 40], each=True)
    wf.if_("Sent?", "={{ $json.ok }}", TRUE, [2800, 40])
    wf.rpc("Mark sent", "mark_email_sent",
           "={{ JSON.stringify({ p_email_id: $json.email_id, p_message_id: $json.message_id }) }}", [3000, -40])
    wf.if_("Newly sent?", "={{ $json.notify_email }}", EXISTS, [3200, -40])
    wf.code("Notification", src("common/notification-texts.js") + src("email-send/notification.js"), [3400, -40], each=True)
    wf.http("Notify user", [3600, -40], url=f"={{{{ {CFG}.forwardemail_api_url }}}}", credential="forwardemail",
            body="={{ JSON.stringify($json) }}", continue_on_error=True)
    wf.rpc("Mark failed", "mark_email_failed",
           "={{ JSON.stringify({ p_email_id: $json.email_id, p_error: $json.error }) }}", [3000, 160])
    wf.chain("Lease approved emails", "Has email?", "Sign attachment URLs", "Build message", "Ready?")
    wf.link("Ready?", "Send via Forward Email", 0)
    wf.link("Ready?", "Mark failed", 1)
    wf.chain("Send via Forward Email", "Result", "Sent?")
    wf.link("Sent?", "Mark sent", 0)
    wf.link("Sent?", "Mark failed", 1)
    wf.chain("Mark sent", "Newly sent?")
    wf.link("Newly sent?", "Notification", 0)
    wf.chain("Notification", "Notify user")
    wf.export()


if __name__ == "__main__":
    for build in (config, flight_check, email_draft, email_send):
        build()
    print("built:", ", ".join(sorted(p.name for p in OUT.glob("airclaim-*.json"))))
