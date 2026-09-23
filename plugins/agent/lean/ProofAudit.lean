import Lean

open Lean Elab Command

elab "audit_theorems" "[" claims:ident,* "]" : command => do
  let allowed : Array Name := #[``propext, ``Classical.choice, ``Quot.sound]
  for claim in claims.getElems do
    let name := claim.getId
    let info ← getConstInfo name
    match info with
    | .thmInfo _ => pure ()
    | _ => throwError "Expected a theorem: {name}"
    let dependencies ← collectAxioms name
    for dependency in dependencies do
      unless allowed.contains dependency do
        throwError "Disallowed axiom {dependency} in {name}"
  logInfo m!"Axiom audit passed for {claims.getElems.size} explicit theorem declarations."
