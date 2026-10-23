"""SHOSHO automation layer — agent orchestrator and agents (D-020).

Identity, in one place because everything else depends on it: this process connects to
Postgres **directly** as the dedicated, non-``BYPASSRLS`` ``agent`` role via
``AUTOMATION_DATABASE_URL`` — never through PostgREST and never as ``service_role``
(``docs/security.md`` §9.1, ``docs/api-contracts.md`` §8.8a). A direct connection carries no
JWT, so ``auth.uid()`` is null and ``is_staff()`` is false for this process no matter what.
The policies that apply are the ones keyed on ``current_user = 'agent'``.
"""

__all__ = ["__version__"]

__version__ = "0.1.0"
