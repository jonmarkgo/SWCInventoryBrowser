// SWC Inventory Control - Client-side JS

document.addEventListener('DOMContentLoaded', () => {
  // Auto-dismiss alerts after 5 seconds
  document.querySelectorAll('.alert-dismissible').forEach((alert) => {
    setTimeout(() => {
      const bsAlert = bootstrap.Alert.getOrCreateInstance(alert);
      bsAlert.close();
    }, 5000);
  });

  // Add to Group modal - populate hidden fields from button data attributes
  document.querySelectorAll('.add-to-group-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.getElementById('modal-entity-type').value = btn.dataset.entityType;
      document.getElementById('modal-entity-uid').value = btn.dataset.entityUid;
      document.getElementById('modal-entity-name').value = btn.dataset.entityName || '';
      document.getElementById('modal-entity-image').value = btn.dataset.entityImage || '';
      document.getElementById('modal-item-label').textContent =
        `${btn.dataset.entityName || btn.dataset.entityUid} (${btn.dataset.entityType})`;
    });
  });

  // Add to Group form - set action URL dynamically
  const addToGroupForm = document.getElementById('addToGroupForm');
  if (addToGroupForm) {
    addToGroupForm.addEventListener('submit', (e) => {
      const groupId = addToGroupForm.querySelector('select[name="group_id"]').value;
      if (!groupId) {
        e.preventDefault();
        return;
      }
      addToGroupForm.action = `/groups/${groupId}/items`;
    });
  }

  // Sub-user action modal - toggle field visibility based on action type
  document.querySelectorAll('.action-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      document.getElementById('action-type').value = action;
      document.getElementById('action-entity-type').value = btn.dataset.entityType;
      document.getElementById('action-entity-uid').value = btn.dataset.entityUid;
      document.getElementById('action-entity-label').textContent =
        `${btn.dataset.entityName || btn.dataset.entityUid} (${btn.dataset.entityType})`;

      const titleMap = {
        assign: 'Assign Owner',
        rename: 'Rename',
        makeover: 'Makeover',
        tag: 'Manage Tag',
      };
      document.getElementById('actionModalTitle').textContent = titleMap[action] || 'Action';

      // Show/hide relevant fields
      ['assign', 'rename', 'makeover', 'tag'].forEach((a) => {
        const el = document.getElementById(`${a}-fields`);
        if (el) el.style.display = a === action ? 'block' : 'none';
      });
    });
  });

  // Tag management via AJAX (entity detail page)
  const addTagForm = document.getElementById('add-tag-form');
  if (addTagForm) {
    addTagForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const entityType = addTagForm.dataset.entityType;
      const entityUid = addTagForm.dataset.entityUid;
      const tagInput = addTagForm.querySelector('input[name="tag"]');
      const tag = tagInput.value.trim();
      if (!tag) return;

      try {
        const resp = await fetch(`/api/inventory/${entityType}/${entityUid}/tag`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tag }),
        });

        if (resp.ok) {
          // Reload page to show updated tags
          window.location.reload();
        } else {
          const data = await resp.json();
          alert(`Failed to add tag: ${data.error || 'Unknown error'}`);
        }
      } catch (err) {
        alert(`Error: ${err.message}`);
      }
    });
  }

  // Remove tag buttons
  document.querySelectorAll('.remove-tag-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const entityType = btn.dataset.entityType;
      const entityUid = btn.dataset.entityUid;
      const tag = btn.dataset.tag;

      if (!confirm(`Remove tag "${tag}"?`)) return;

      try {
        const resp = await fetch(`/api/inventory/${entityType}/${entityUid}/tag`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tag }),
        });

        if (resp.ok) {
          window.location.reload();
        } else {
          const data = await resp.json();
          alert(`Failed to remove tag: ${data.error || 'Unknown error'}`);
        }
      } catch (err) {
        alert(`Error: ${err.message}`);
      }
    });
  });
});
