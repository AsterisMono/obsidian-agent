import PlanSteadyFalconFormalVerification.Core

namespace PlanSteadyFalconFormalVerification.RunOwnership

inductive Phase where
  | preparing
  | saving
  | streaming
  deriving DecidableEq, Repr

structure Run where
  token : Token
  chat : String
  phase : Phase
  deriving DecidableEq, Repr

structure State where
  epoch : Nat := 0
  live : Bool := true
  owner : Option Run := none
  used : List Token := []
  prompts : List Token := []
  partialText : Text := []
  error : Text := []
  deriving DecidableEq, Repr

def owns (s : State) (token : Token) : Bool :=
  s.live && s.owner.any (fun run => run.token == token)

def begin (s : State) (token : Token) (chat : String) (validInput : Bool) : State :=
  if s.live && validInput && s.owner.isNone && token.epoch == s.epoch && !(s.used.contains token) then
    { s with owner := some ⟨token, chat, .preparing⟩, used := token :: s.used, partialText := [], error := [] }
  else s

def skillsReady (s : State) (token : Token) : State :=
  if owns s token then
    match s.owner with
    | some run => if run.phase = .preparing then
        { s with owner := some { run with phase := .saving } } else s
    | none => s
  else s

def saved (s : State) (token : Token) : State :=
  if owns s token then
    match s.owner with
    | some run => if run.phase = .saving then
        { s with owner := some { run with phase := .streaming }, prompts := token :: s.prompts }
      else s
    | none => s
  else s

def publish (s : State) (token : Token) (text : Text) : State :=
  if owns s token then { s with partialText := text } else s

def finish (s : State) (token : Token) (error : Text) : State :=
  if owns s token then { s with owner := none, partialText := [], error := error } else s

def cancel (s : State) : State := { s with owner := none, partialText := [] }

def unload (s : State) : State := { cancel s with live := false }

inductive Event where
  | send (token : Token) (chat : String) (validInput : Bool)
  | skills (token : Token)
  | save (token : Token)
  | output (token : Token) (text : Text)
  | done (token : Token) (error : Text)
  | cancel
  | unload
  | reload (epoch : Nat)

def step (s : State) : Event → State
  | .send token chat valid => begin s token chat valid
  | .skills token => skillsReady s token
  | .save token => saved s token
  | .output token text => publish s token text
  | .done token error => finish s token error
  | .cancel => cancel s
  | .unload => unload s
  | .reload epoch => { epoch := epoch, used := s.used, prompts := s.prompts }

def Invariant (s : State) : Prop :=
  ∀ run, s.owner = some run → s.live = true ∧ run.token.epoch = s.epoch ∧ run.token ∈ s.used

theorem initial_valid : Invariant {} := by simp [Invariant]

theorem busy_rejects (busy : s.owner = some run) : begin s token chat valid = s := by
  simp [begin, busy]

theorem stale_output (stale : owns s token = false) : publish s token text = s := by
  simp [publish, stale]

theorem stale_completion (stale : owns s token = false) : finish s token error = s := by
  simp [finish, stale]

theorem cancellation_invalidates (s : State) (token : Token) :
    owns (cancel s) token = false ∧ saved (cancel s) token = cancel s := by
  simp [cancel, owns, saved]

theorem success_starts_one_prompt (token : Token) (chat : String) :
    let initial : State := { epoch := token.epoch }
    let prepared := begin initial token chat true
    let running := saved (skillsReady prepared token) token
    running.prompts = [token] ∧ saved running token = running := by
  simp [begin, skillsReady, saved, owns]

theorem step_preserves (valid : Invariant s) (event : Event) : Invariant (step s event) := by
  cases event <;> grind [step, begin, skillsReady, saved, publish, finish, cancel, unload, Invariant, owns]

theorem reachable_valid (trace : Reachable step ({} : State) s) : Invariant s :=
  reachable_invariant step {} Invariant initial_valid (fun _ e h => step_preserves h e) trace

end PlanSteadyFalconFormalVerification.RunOwnership
