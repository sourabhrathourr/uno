# Vote-kicked players use separate state

Vote-Kicked Player state is stored separately from normal UNO elimination state. We accept the extra state because vote-kicks need distinct UI treatment, lobby readiness behavior, voting restrictions, and one-match reset rules that would be easy to lose if vote-kicked players were folded into `eliminatedPlayerIds`.
