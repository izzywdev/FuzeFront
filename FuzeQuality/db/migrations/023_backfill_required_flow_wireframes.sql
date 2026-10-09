-- FQ-202/FQ-211: a UX-flow candidate must always carry a review wireframe.
UPDATE fuzequality.repository_flow_candidates
SET wireframe = jsonb_build_object(
  'kind', 'sequence',
  'nodes', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'label', COALESCE(step->>'action', 'Flow step'),
      'targetIds', COALESCE(step->'targetIds', '[]'::jsonb)
    ))
    FROM jsonb_array_elements(steps) AS step
  ), '[]'::jsonb)
)
WHERE wireframe IS NULL
   OR jsonb_typeof(wireframe->'nodes') <> 'array'
   OR jsonb_array_length(wireframe->'nodes') = 0;
