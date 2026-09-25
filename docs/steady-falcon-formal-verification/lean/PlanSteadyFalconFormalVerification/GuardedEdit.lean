import PlanSteadyFalconFormalVerification.Core

namespace PlanSteadyFalconFormalVerification.GuardedEdit

inductive Editor where
  | unrelated
  | unavailable
  | text (value : Text)
  deriving DecidableEq, Repr

inductive Rejection where
  | invalidPath
  | missingSnapshot
  | missingFile
  | editorConflict
  deriving DecidableEq, Repr

inductive Prepared where
  | rejected (reason : Rejection)
  | ready (snapshot : Text)
  deriving DecidableEq, Repr

def editorAllows (editor : Editor) (snapshot : Text) : Bool :=
  match editor with
  | .unrelated => true
  | .unavailable => false
  | .text value => value == snapshot

def prepare (acceptedPath fileExists : Bool) (remembered : Option Text) (editor : Editor) : Prepared :=
  if !acceptedPath then .rejected .invalidPath
  else match remembered with
    | none => .rejected .missingSnapshot
    | some snapshot =>
      if !fileExists then .rejected .missingFile
      else if editorAllows editor snapshot then .ready snapshot
      else .rejected .editorConflict

inductive Decision where
  | conflict
  | write (replacement : Text)
  deriving DecidableEq, Repr

def commit (snapshot replacement current : Text) : Decision :=
  if current = snapshot then .write replacement else .conflict

def applyDecision (current : Text) : Decision → Text
  | .conflict => current
  | .write replacement => replacement

inductive Completion where
  | rejected
  | failedBeforeCommit
  | failedUnknown
  | succeeded
  deriving DecidableEq, Repr

def remember (snapshots : String → Option Text) (path : String) (replacement : Text)
    (completion : Completion) : String → Option Text :=
  match completion with
  | .succeeded => put snapshots path (some replacement)
  | _ => snapshots

theorem ready_has_snapshot
    (h : prepare accepted fileExists remembered editor = .ready snapshot) :
    remembered = some snapshot := by
  cases remembered <;> grind [prepare]

theorem guarded_commit
    (prepared : prepare accepted fileExists remembered editor = .ready snapshot)
    (written : commit snapshot replacement current = .write output) :
    remembered = some current ∧ output = replacement := by
  have hs := ready_has_snapshot prepared
  unfold commit at written
  split at written
  · cases written
    exact ⟨by simp_all, rfl⟩
  · contradiction

theorem conflict_preserves_disk (different : current ≠ snapshot) :
    applyDecision current (commit snapshot replacement current) = current := by
  simp [commit, different, applyDecision]

theorem useful_success (snapshot replacement : Text) :
    prepare true true (some snapshot) (.text snapshot) = .ready snapshot ∧
    applyDecision snapshot (commit snapshot replacement snapshot) = replacement := by
  simp [prepare, editorAllows, commit, applyDecision]

theorem missing_is_not_empty :
    prepare true true none .unrelated = .rejected .missingSnapshot ∧
    prepare true true (some []) .unrelated = .ready [] := by decide

theorem successful_snapshot (snapshots : String → Option Text) (path : String) (replacement : Text) :
    remember snapshots path replacement .succeeded path = some replacement := by
  simp [remember]

theorem other_snapshot_unchanged (different : other ≠ path) :
    remember snapshots path replacement completion other = snapshots other := by
  cases completion <;> simp [remember, different]

theorem failure_preserves_snapshots (failed : completion ≠ .succeeded) :
    remember snapshots path replacement completion = snapshots := by
  cases completion <;> simp_all [remember]

end PlanSteadyFalconFormalVerification.GuardedEdit
