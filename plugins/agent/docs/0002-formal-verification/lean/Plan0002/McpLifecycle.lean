import Plan0002.Core

namespace Plan0002.McpLifecycle

structure Attempt where
  token : Token
  configuration : Nat
  deriving DecidableEq, Repr

structure State where
  live : Bool := true
  desired : Option Attempt := none
  connected : Option Attempt := none
  published : Option Attempt := none
  usedTokens : List Token := []
  closing : List Attempt := []
  error : Option Text := none
  deriving DecidableEq, Repr

def current (s : State) (attempt : Attempt) : Bool :=
  s.live && s.desired == some attempt

def retire (s : State) : List Attempt :=
  s.desired.toList ++ s.connected.toList ++ s.published.toList ++ s.closing

def configure (s : State) (desired : Option Attempt) : State :=
  if s.live then
    if s.desired = desired then s
    else match desired with
      | none => { s with desired := none, connected := none, published := none,
                         closing := retire s, error := none }
      | some attempt =>
        if s.usedTokens.contains attempt.token then s
        else { s with desired := desired, connected := none, published := none,
                      usedTokens := attempt.token :: s.usedTokens, closing := retire s, error := none }
  else s

def connect (s : State) (attempt : Attempt) : State :=
  if current s attempt then { s with connected := some attempt }
  else { s with closing := attempt :: s.closing }

def discover (s : State) (attempt : Attempt) : State :=
  if current s attempt && s.connected == some attempt then { s with published := some attempt }
  else { s with closing := attempt :: s.closing }

def fail (s : State) (attempt : Attempt) (error : Text) : State :=
  if current s attempt then
    { s with desired := none, connected := none, published := none, error := some error,
             closing := attempt :: s.closing }
  else { s with closing := attempt :: s.closing }

def unload (s : State) : State :=
  { live := false, usedTokens := s.usedTokens, closing := retire s }

inductive Event where
  | configure (desired : Option Attempt)
  | connected (attempt : Attempt)
  | discovered (attempt : Attempt)
  | failed (attempt : Attempt) (error : Text)
  | closeSucceeded (attempt : Attempt)
  | closeFailed (attempt : Attempt)
  | unload

def step (s : State) : Event → State
  | .configure desired => configure s desired
  | .connected attempt => connect s attempt
  | .discovered attempt => discover s attempt
  | .failed attempt error => fail s attempt error
  | .closeSucceeded attempt => { s with closing := s.closing.filter (· != attempt) }
  | .closeFailed _ => s
  | .unload => unload s

def Invariant (s : State) : Prop :=
  ∀ attempt, s.published = some attempt →
    s.live = true ∧ s.desired = some attempt ∧ s.connected = some attempt

theorem initial_valid : Invariant {} := by simp [Invariant]

theorem stale_success_disposed (stale : current s attempt = false) :
    (discover s attempt).published = s.published ∧ attempt ∈ (discover s attempt).closing := by
  simp [discover, stale]

theorem stale_failure_preserves_error (stale : current s attempt = false) :
    (fail s attempt error).error = s.error := by simp [fail, stale]

theorem unload_cannot_republish (s : State) (attempt : Attempt) :
    (discover (connect (unload s) attempt) attempt).published = none := by
  simp [discover, connect, unload, current]

theorem useful_connection (attempt : Attempt) :
    let requested := configure {} (some attempt)
    (discover (connect requested attempt) attempt).published = some attempt := by
  simp [configure, discover, connect, current]

theorem used_token_cannot_restart (disabled : s.desired = none)
    (used : attempt.token ∈ s.usedTokens) : configure s (some attempt) = s := by
  simp [configure, disabled, used]

theorem disable_reenable_cannot_reuse_attempt (attempt : Attempt) :
    let requested := configure {} (some attempt)
    let disabled := configure requested none
    let reused := configure disabled (some attempt)
    (discover (connect reused attempt) attempt).published = none := by
  simp [configure, discover, connect, current]

theorem failure_invalidates_attempt (failed : current s attempt = true) :
    (discover (connect (fail s attempt error) attempt) attempt).published = none := by
  simp only [fail, failed, if_true]
  simp [connect, discover, current]

theorem step_preserves (valid : Invariant s) (event : Event) : Invariant (step s event) := by
  cases event <;> simp only [step]
  case configure desired =>
    cases desired <;> grind [Invariant, configure]
  all_goals grind [Invariant, connect, discover, fail, unload, current]

theorem reachable_valid (trace : Reachable step ({} : State) s) : Invariant s :=
  reachable_invariant step {} Invariant initial_valid (fun _ e h => step_preserves h e) trace

end Plan0002.McpLifecycle
