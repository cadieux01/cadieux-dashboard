import { supabase } from './supabase'
import { formatDateDDMMYY } from './date'

/**
 * Log an audit event
 * @param {Object} params
 * @param {string} params.actionType - 'CREATE', 'UPDATE', 'DELETE'
 * @param {string} params.entityType - 'sale', 'lead', 'trainer', 'retract'
 * @param {string} params.entityId - ID of the affected record
 * @param {string} params.description - Human-readable description
 * @param {Object} params.oldValues - Previous values (for updates)
 * @param {Object} params.newValues - New values
 * @param {Object} params.metadata - Additional context
 */
export async function logAuditEvent({
  actionType,
  entityType,
  entityId,
  description,
  oldValues = null,
  newValues = null,
  metadata = null,
}) {
  try {
    // Get current user and profile
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      console.warn('Cannot log audit: No authenticated user')
      return
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single()

    const userName = profile?.full_name || user.email || 'Unknown User'

    // Insert audit log
    const { error } = await supabase
      .from('audit_logs')
      .insert({
        user_id: user.id,
        user_name: userName,
        action_type: actionType,
        entity_type: entityType,
        entity_id: entityId,
        description,
        old_values: oldValues,
        new_values: newValues,
        metadata: metadata,
      })

    if (error) {
      console.error('Error logging audit event:', error)
      // Don't throw - audit logging shouldn't break the main flow
    }
  } catch (error) {
    console.error('Exception in audit logging:', error)
    // Fail silently to not disrupt user experience
  }
}

/**
 * Helper to create human-readable descriptions with initial and changed values
 */
export function createAuditDescription(actionType, entityType, data, relatedEntity = null, oldValues = null, newValues = null) {
  const SEPARATOR = ' | ' // Separator between sentences

  const actionMap = {
    CREATE: 'created',
    UPDATE: 'updated',
    DELETE: 'deleted',
  }

  const entityMap = {
    sale: 'sale',
    lead: 'customer',
    trainer: 'partner',
    retract: 'retract',
    order_invitation: 'order invitation',
    user: 'user',
  }

  const action = actionMap[actionType] || actionType.toLowerCase()
  const entity = entityMap[entityType] || entityType

  switch (entityType) {
    case 'sale':
      if (actionType === 'CREATE') {
        const partnerName = relatedEntity?.name || 'Unknown Partner'
        return `${partnerName} has been assigned ${data.units_assigned || 0} units`
      } else if (actionType === 'UPDATE') {
        const partnerName = relatedEntity?.name || 'Unknown Partner'

        // First sentence: initial values
        const initialParts = []
        if (oldValues?.units_assigned !== undefined) initialParts.push(`${oldValues.units_assigned} units assigned`)
        if (oldValues?.units_sold !== undefined) initialParts.push(`${oldValues.units_sold} units sold`)
        if (oldValues?.retracted_units !== undefined && oldValues.retracted_units > 0) initialParts.push(`${oldValues.retracted_units} units retracted`)
        const initialSentence = initialParts.length > 0
          ? `Initial values for ${partnerName}: ${initialParts.join(', ')}`
          : `Initial values for ${partnerName}: No previous data`

        // Second sentence: changed values
        const changedParts = []
        if (newValues?.units_assigned !== undefined) changedParts.push(`${newValues.units_assigned} units assigned`)
        if (newValues?.units_sold !== undefined) changedParts.push(`${newValues.units_sold} units sold`)
        if (newValues?.retracted_units !== undefined && newValues.retracted_units > 0) changedParts.push(`${newValues.retracted_units} units retracted`)
        if (newValues?.date_of_assignment !== undefined) changedParts.push(`date: ${formatDateDDMMYY(newValues.date_of_assignment)}`)
        const changedSentence = changedParts.length > 0
          ? `Changed to: ${changedParts.join(', ')}`
          : `Changed to: No changes`

        return `${initialSentence}${SEPARATOR}${changedSentence}`
      } else if (actionType === 'DELETE') {
        const partnerName = relatedEntity?.name || 'Unknown Partner'
        const initialParts = []
        if (oldValues?.units_assigned !== undefined) initialParts.push(`${oldValues.units_assigned} units assigned`)
        if (oldValues?.units_sold !== undefined) initialParts.push(`${oldValues.units_sold} units sold`)
        const initialSentence = initialParts.length > 0
          ? `Initial values for ${partnerName}: ${initialParts.join(', ')}`
          : `Initial values for ${partnerName}: No previous data`
        return `${initialSentence}${SEPARATOR}Deleted sale record`
      }
      break

    case 'lead':
      if (actionType === 'CREATE') {
        return `Created customer: ${data.buyer_name || 'Unknown'}`
      } else if (actionType === 'UPDATE') {
        const buyerName = data.buyer_name || oldValues?.buyer_name || 'Unknown'
        const initialParts = []
        if (oldValues?.buyer_name) initialParts.push(`name: ${oldValues.buyer_name}`)
        if (oldValues?.buyer_contact) initialParts.push(`contact: ${oldValues.buyer_contact}`)
        if (oldValues?.status) initialParts.push(`status: ${oldValues.status}`)
        const initialSentence = initialParts.length > 0
          ? `Initial values for customer: ${initialParts.join(', ')}`
          : `Initial values for customer: No previous data`

        const changedParts = []
        if (newValues?.buyer_name) changedParts.push(`name: ${newValues.buyer_name}`)
        if (newValues?.buyer_contact) changedParts.push(`contact: ${newValues.buyer_contact || 'N/A'}`)
        if (newValues?.status) changedParts.push(`status: ${newValues.status}`)
        const changedSentence = changedParts.length > 0
          ? `Changed to: ${changedParts.join(', ')}`
          : `Changed to: No changes`

        return `${initialSentence}${SEPARATOR}${changedSentence}`
      } else if (actionType === 'DELETE') {
        const buyerName = oldValues?.buyer_name || 'Unknown'
        const initialParts = []
        if (oldValues?.buyer_name) initialParts.push(`name: ${oldValues.buyer_name}`)
        if (oldValues?.buyer_contact) initialParts.push(`contact: ${oldValues.buyer_contact}`)
        const initialSentence = initialParts.length > 0
          ? `Initial values for customer: ${initialParts.join(', ')}`
          : `Initial values for customer: No previous data`
        return `${initialSentence}${SEPARATOR}Deleted customer record`
      }
      break

    case 'trainer':
      if (actionType === 'CREATE') {
        return `Created partner: ${data.name || 'Unknown'}`
      } else if (actionType === 'UPDATE') {
        const partnerName = data.name || oldValues?.name || 'Unknown'
        const initialParts = []
        if (oldValues?.name) initialParts.push(`name: ${oldValues.name}`)
        if (oldValues?.contact) initialParts.push(`contact: ${oldValues.contact}`)
        if (oldValues?.notes) initialParts.push(`notes: ${oldValues.notes}`)
        const initialSentence = initialParts.length > 0
          ? `Initial values for partner: ${initialParts.join(', ')}`
          : `Initial values for partner: No previous data`

        const changedParts = []
        if (newValues?.name) changedParts.push(`name: ${newValues.name}`)
        if (newValues?.contact !== undefined) changedParts.push(`contact: ${newValues.contact || 'N/A'}`)
        if (newValues?.notes !== undefined) changedParts.push(`notes: ${newValues.notes || 'N/A'}`)
        const changedSentence = changedParts.length > 0
          ? `Changed to: ${changedParts.join(', ')}`
          : `Changed to: No changes`

        return `${initialSentence}${SEPARATOR}${changedSentence}`
      } else if (actionType === 'DELETE') {
        const partnerName = oldValues?.name || 'Unknown'
        const initialParts = []
        if (oldValues?.name) initialParts.push(`name: ${oldValues.name}`)
        if (oldValues?.contact) initialParts.push(`contact: ${oldValues.contact}`)
        const initialSentence = initialParts.length > 0
          ? `Initial values for partner: ${initialParts.join(', ')}`
          : `Initial values for partner: No previous data`
        return `${initialSentence}${SEPARATOR}Deleted partner record`
      }
      break

    case 'retract':
      if (actionType === 'CREATE' || actionType === 'UPDATE') {
        const partnerName = relatedEntity?.name || 'Unknown Partner'
        const initialRetracted = oldValues?.retracted_units || 0
        const newRetracted = newValues?.retracted_units || data.retracted_units || 0
        const initialSentence = `Initial retracted units for ${partnerName}: ${initialRetracted}`
        const changedSentence = `Changed to: ${newRetracted} units retracted`
        return `${initialSentence}${SEPARATOR}${changedSentence}`
      }
      break
  }

  return `${action} ${entity}`
}
