import PlanSteadyFalconFormalVerification.GuardedEdit
import PlanSteadyFalconFormalVerification.RunOwnership
import PlanSteadyFalconFormalVerification.McpRegistry
import PlanSteadyFalconFormalVerification.McpLifecycle
import PlanSteadyFalconFormalVerification.VaultPaths
import PlanSteadyFalconFormalVerification.RestoreState
import Lean.Data.Json

open PlanSteadyFalconFormalVerification Lean

def units (value : Text) : Json := toJson (value.map UInt16.toNat)

def optionalUnits (value : Option Text) : Json :=
  match value with
  | none => .null
  | some text => units text

def recordCase (id : String) (contract : String) (input expected : Json) : Json :=
  Json.mkObj [("id", toJson id), ("contract", toJson contract), ("input", input), ("expected", expected)]

def editCase (id : String) (snapshot : Option Text) (editor : GuardedEdit.Editor)
    (disk replacement : Text) (completion : GuardedEdit.Completion) : Json :=
  let prepared := GuardedEdit.prepare true true snapshot editor
  let (status, output, remembered) := match prepared with
    | .rejected why => (reprStr why, some disk, snapshot)
    | .ready known => match GuardedEdit.commit known replacement disk with
      | .conflict => ("diskConflict", some disk, snapshot)
      | .write text =>
        let memory := GuardedEdit.remember (fun _ => snapshot) "Note.md" text completion "Note.md"
        match completion with
        | .succeeded => ("success", some text, memory)
        | .failedUnknown => ("effectFailureUnknownDisk", none, memory)
        | _ => ("effectFailureBeforeCommit", some disk, memory)
  recordCase id "V1-V5"
    (Json.mkObj [("snapshot", optionalUnits snapshot), ("editor", toJson (reprStr editor)),
      ("disk", units disk), ("replacement", units replacement), ("completion", toJson (reprStr completion))])
    (Json.mkObj [("status", toJson status), ("disk", optionalUnits output),
      ("snapshot", optionalUnits remembered)])

def pathCase (id : String) (raw normalized : Text) : Json :=
  let result := VaultPaths.accept raw normalized
  recordCase id "P1-P3"
    (Json.mkObj [("raw", units raw), ("normalized", units normalized)])
    (Json.mkObj [("accepted", toJson result.isSome),
      ("segments", match result with
        | none => .null
        | some segments => .arr (segments.map units).toArray)])

def runCases : List Json := Id.run do
  let first : Token := ⟨0, 1⟩
  let second : Token := ⟨0, 2⟩
  let started := RunOwnership.begin {} first "chat" true
  let overlapping := RunOwnership.begin started second "chat" true
  let cancelled := RunOwnership.cancel started
  let late := RunOwnership.saved (RunOwnership.skillsReady cancelled first) first
  let newer := RunOwnership.begin cancelled second "chat" true
  let stale := RunOwnership.finish (RunOwnership.publish newer first [79, 76, 68]) first [69]
  return [
    recordCase "run-preparation-overlap" "R1"
      (toJson ["send token 0:1 chat", "send token 0:2 chat"])
      (Json.mkObj [("ownerSerial", toJson (overlapping.owner.map (·.token.serial))),
        ("promptCount", toJson overlapping.prompts.length)]),
    recordCase "run-cancel-before-save" "R3"
      (toJson ["send token 0:1 chat", "cancel", "skills 0:1", "save 0:1"])
      (Json.mkObj [("ownerPresent", toJson late.owner.isSome), ("promptCount", toJson late.prompts.length)]),
    recordCase "run-stale-same-chat" "R2"
      (toJson ["send 0:1 chat", "cancel", "send 0:2 chat", "output 0:1 OLD", "done 0:1 E"])
      (Json.mkObj [("ownerSerial", toJson (stale.owner.map (·.token.serial))),
        ("partialText", units stale.partialText), ("error", units stale.error)])]

def mcpCases : List Json := Id.run do
  let name : Text := [109, 99, 112, 95, 97, 98, 95, 112, 105, 110, 103]
  let target : McpRegistry.Target := ⟨"a-b", "ping", ⟨0, 1⟩⟩
  let other : McpRegistry.Target := ⟨"ab", "ping", ⟨0, 2⟩⟩
  let first := McpRegistry.register McpRegistry.empty name target (McpRegistry.nameAllowed 64 [])
  let second := McpRegistry.register first.2 name other (McpRegistry.nameAllowed 64 [])
  let routed := McpRegistry.dispatch second.2 (fun _ => some target.generation) name target
  let attempt : McpLifecycle.Attempt := ⟨⟨0, 1⟩, 1⟩
  let requested := McpLifecycle.configure {} (some attempt)
  let disabled := McpLifecycle.configure requested none
  let late := McpLifecycle.discover (McpLifecycle.connect disabled attempt) attempt
  let good := McpLifecycle.discover (McpLifecycle.connect requested attempt) attempt
  let reused := McpLifecycle.configure disabled (some attempt)
  let replayed := McpLifecycle.discover (McpLifecycle.connect reused attempt) attempt
  return [
    recordCase "mcp-name-collision" "M1-M3"
      (Json.mkObj [("name", units name), ("servers", toJson ["a-b", "ab"]), ("tool", toJson "ping")])
      (Json.mkObj [("firstAccepted", toJson first.1), ("secondAccepted", toJson second.1),
        ("receivingServer", toJson (routed.map (·.server)))]),
    recordCase "mcp-disabled-late-success" "M4-M5"
      (toJson ["configure attempt 0:1 revision 1", "disable", "connect 0:1", "discover 0:1"])
      (Json.mkObj [("published", toJson late.published.isSome), ("closeRequested", toJson (late.closing.contains attempt))]),
    recordCase "mcp-current-success" "M6"
      (toJson ["configure attempt 0:1 revision 1", "connect 0:1", "discover 0:1"])
      (Json.mkObj [("published", toJson good.published.isSome)]),
    recordCase "mcp-retired-token-reuse" "M4-M5"
      (toJson ["configure attempt 0:1 revision 1", "disable", "configure attempt 0:1 revision 1",
        "late connect 0:1", "late discover 0:1"])
      (Json.mkObj [("published", toJson replayed.published.isSome),
        ("closeRequested", toJson (replayed.closing.contains attempt))])]

def restoreCase : Json :=
  let input : RestoreState.State := ⟨[⟨"chat", true, false, []⟩], "missing"⟩
  let output := RestoreState.restore input "fresh"
  recordCase "restore-pending-missing-selection" "D1-D3"
    (Json.mkObj [("chatId", toJson "chat"), ("pending", toJson true),
      ("selected", toJson "missing"), ("freshId", toJson "fresh")])
    (Json.mkObj [("selected", toJson output.selected),
      ("chats", .arr (output.chats.map (fun chat => Json.mkObj [
        ("id", toJson chat.id), ("pending", toJson chat.pending), ("interrupted", toJson chat.interrupted)])).toArray)])

def failureCase : Json :=
  let initial : RestoreState.SaveQueue Text := { current := [66], lastSuccessfulInput := some [65] }
  let started := RestoreState.startSave (RestoreState.enqueue initial)
  let failed := RestoreState.finishSave started false
  let next := RestoreState.startSave (RestoreState.enqueue failed)
  recordCase "save-failure-bookkeeping" "D4"
    (Json.mkObj [("current", units [66]), ("lastSuccessfulInput", units [65]),
      ("events", toJson ["enqueue", "start", "fail", "enqueue", "start"])])
    (Json.mkObj [("lastSuccessfulInput", optionalUnits failed.lastSuccessfulInput),
      ("diskAfterFailure", toJson "unknown"), ("nextInFlight", optionalUnits next.inFlight)])

def skillCase : Json :=
  let file : VaultPaths.Segments := [[], [83, 75, 73, 76, 76, 46, 109, 100]]
  recordCase "skill-empty-segment-folder" "P2"
    (Json.mkObj [("folder", .arr #[units []]), ("file", .arr (file.map units).toArray)])
    (Json.mkObj [("discovered", toJson (VaultPaths.skill [[]] file))])

def cases : List Json :=
  [editCase "edit-success" (some [65]) (.text [65]) [65] [67] .succeeded,
   editCase "edit-empty-snapshot" (some []) .unrelated [] [67] .succeeded,
   editCase "edit-no-snapshot" none .unrelated [] [67] .succeeded,
   editCase "edit-stale-disk" (some [65]) .unrelated [66] [67] .succeeded,
   editCase "edit-stale-editor" (some [65]) (.text [66]) [65] [67] .succeeded,
   editCase "edit-io-before-commit" (some [65]) .unrelated [65] [67] .failedBeforeCommit,
   editCase "edit-io-unknown" (some [65]) .unrelated [65] [67] .failedUnknown,
   editCase "edit-utf16" (some [55357, 56832, 13, 10]) .unrelated [55357, 56832, 13, 10] [55296] .succeeded,
   pathCase "path-repeated-separator" [65, 47, 47, 66, 46, 77, 68] [65, 47, 66, 46, 77, 68],
   pathCase "path-parent-rejected" [46, 46, 47, 65, 46, 109, 100] [46, 46, 47, 65, 46, 109, 100],
   restoreCase, failureCase, skillCase] ++ runCases ++ mcpCases

def main : IO Unit := do
  let output := Json.mkObj [("schemaVersion", toJson (1 : Nat)), ("cases", toJson cases)]
  (← IO.getStdout).putStrLn output.compress
