import { supabase } from './supabase'

// ============================================================================
// records.js — data layer for the agent's Records page (past performance).
//
// Scopes to the logged-in agent via sales.agent_id (stamped by assign_sale_fifo
// = auth.uid()). Returns the agent's OWN assignment rows with the partner that
// received each one embedded. Aggregation (per-partner + agent summary) is done
// in the page from these rows. Legacy rows (NULL agent_id) are simply excluded.
// ============================================================================

// Fetch all of an agent's assignment/sale rows (newest first) with partner info.
export async function getAgentRecords(agentId) {
  if (!agentId) return []
  const { data, error } = await supabase
    .from('sales')
    .select(`
      id,
      trainer_id,
      units_assigned,
      units_sold,
      retracted_units,
      multigrain_assigned,
      plain_assigned,
      multigrain_retracted,
      plain_retracted,
      product_variant,
      unit_price,
      date_of_assignment,
      purchase_date,
      created_at,
      trainers:profiles (
        id,
        name:full_name,
        contact:phone_number
      )
    `)
    .eq('agent_id', agentId)
    .order('date_of_assignment', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (error) throw error
  return data || []
}
