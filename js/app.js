let currentUser = null;
let borrowers   = {};
let loans       = {};

// ── Auth Guard ──────────────────────────────────────────────
auth.onAuthStateChanged(user => {
  if (user) {
    currentUser = user;
    document.getElementById('userName').textContent = user.displayName || user.email;
    loadDashboard();
  } else {
    window.location.href = 'index.html';
  }
});

// ── Load Data ───────────────────────────────────────────────
async function loadDashboard() {
  const [bSnap, lSnap] = await Promise.all([
    db.collection(`users/${currentUser.uid}/borrowers`).orderBy('createdAt', 'desc').get(),
    db.collection(`users/${currentUser.uid}/loans`).get()
  ]);

  borrowers = {};
  bSnap.forEach(doc => { borrowers[doc.id] = { id: doc.id, ...doc.data() }; });

  loans = {};
  lSnap.forEach(doc => { loans[doc.id] = { id: doc.id, ...doc.data() }; });

  renderBorrowers();
  updateSummary();
}

// ── Add Borrower ────────────────────────────────────────────
async function addBorrower(name, phone, note) {
  await db.collection(`users/${currentUser.uid}/borrowers`).add({
    name, phone, note,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  loadDashboard();
}

// ── Add Loan ────────────────────────────────────────────────
async function addLoan(borrowerId, amount, date, reason, dueDate) {
  await db.collection(`users/${currentUser.uid}/loans`).add({
    borrowerId,
    borrowerName : borrowers[borrowerId].name,
    amount       : parseFloat(amount),
    date, reason, dueDate,
    status       : 'pending',
    totalRepaid  : 0,
    createdAt    : firebase.firestore.FieldValue.serverTimestamp()
  });
  loadDashboard();
}

// ── Add Repayment ───────────────────────────────────────────
async function addRepayment(loanId, amount, date, note) {
  const loan      = loans[loanId];
  const newRepaid = (loan.totalRepaid || 0) + parseFloat(amount);
  const newStatus = newRepaid >= loan.amount ? 'settled' : 'partial';

  const batch  = db.batch();
  const loanRef = db.collection(`users/${currentUser.uid}/loans`).doc(loanId);
  batch.update(loanRef, { totalRepaid: newRepaid, status: newStatus });

  const repRef = db.collection(`users/${currentUser.uid}/repayments`).doc();
  batch.set(repRef, {
    loanId,
    amount   : parseFloat(amount),
    date, note,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  await batch.commit();
  loadDashboard();
}

// ── Delete Borrower ─────────────────────────────────────────
async function deleteBorrower(borrowerId) {
  if (!confirm('Delete this borrower and all their loans?')) return;
  const batch = db.batch();
  Object.values(loans)
    .filter(l => l.borrowerId === borrowerId)
    .forEach(l => batch.delete(db.collection(`users/${currentUser.uid}/loans`).doc(l.id)));
  batch.delete(db.collection(`users/${currentUser.uid}/borrowers`).doc(borrowerId));
  await batch.commit();
  loadDashboard();
}

// ── Render Borrower Cards ───────────────────────────────────
function renderBorrowers(filter = 'all') {
  const container = document.getElementById('borrowerList');
  container.innerHTML = '';
  const list = Object.values(borrowers);

  if (list.length === 0) {
    container.innerHTML = `
      <div class="col-12 text-center text-muted py-5">
        <div style="font-size:3rem">🤝</div>
        <p class="mt-2">No borrowers yet. Hit <strong>Add</strong> to get started!</p>
      </div>`;
    return;
  }

  list.forEach(b => {
    const bLoans      = Object.values(loans).filter(l => l.borrowerId === b.id);
    const totalLent   = bLoans.reduce((s, l) => s + l.amount, 0);
    const totalRepaid = bLoans.reduce((s, l) => s + (l.totalRepaid || 0), 0);
    const outstanding = totalLent - totalRepaid;
    const isOverdue   = bLoans.some(l => l.dueDate && new Date(l.dueDate) < new Date() && l.status !== 'settled');

    if (filter === 'pending' && outstanding === 0) return;
    if (filter === 'settled' && outstanding > 0)   return;

    const badgeClass = outstanding === 0 ? 'success' : isOverdue ? 'danger' : 'warning';
    const badgeText  = outstanding === 0 ? 'Settled'  : isOverdue ? 'Overdue' : 'Pending';

    container.innerHTML += `
      <div class="col-md-6 col-lg-4 mb-3">
        <div class="card borrower-card h-100 shadow-sm" onclick="viewBorrower('${b.id}')">
          <div class="card-body">
            <div class="d-flex justify-content-between align-items-start mb-2">
              <div>
                <h6 class="fw-bold mb-0">${b.name}</h6>
                <small class="text-muted">${b.phone || 'No phone'}</small>
              </div>
              <span class="badge bg-${badgeClass}">${badgeText}</span>
            </div>
            <div class="row text-center mt-3">
              <div class="col-4">
                <div class="small text-muted">Lent</div>
                <div class="fw-bold text-primary">₹${totalLent.toLocaleString('en-IN')}</div>
              </div>
              <div class="col-4">
                <div class="small text-muted">Repaid</div>
                <div class="fw-bold text-success">₹${totalRepaid.toLocaleString('en-IN')}</div>
              </div>
              <div class="col-4">
                <div class="small text-muted">Due</div>
                <div class="fw-bold text-danger">₹${outstanding.toLocaleString('en-IN')}</div>
              </div>
            </div>
            ${b.note ? `<p class="small text-muted mt-2 mb-0">📝 ${b.note}</p>` : ''}
          </div>
          <div class="card-footer bg-transparent d-flex justify-content-between align-items-center">
            <button class="btn btn-sm btn-outline-primary"
              onclick="event.stopPropagation(); openAddLoanModal('${b.id}')">
              <i class="bi bi-plus-circle"></i> Loan
            </button>
            <button class="btn btn-sm btn-outline-danger"
              onclick="event.stopPropagation(); deleteBorrower('${b.id}')">
              <i class="bi bi-trash"></i>
            </button>
          </div>
        </div>
      </div>`;
  });
}

// ── Summary Cards ───────────────────────────────────────────
function updateSummary() {
  const all       = Object.values(loans);
  const tLent     = all.reduce((s, l) => s + l.amount, 0);
  const tRepaid   = all.reduce((s, l) => s + (l.totalRepaid || 0), 0);
  document.getElementById('totalLent').textContent     = '₹' + tLent.toLocaleString('en-IN');
  document.getElementById('totalRepaid').textContent   = '₹' + tRepaid.toLocaleString('en-IN');
  document.getElementById('outstanding').textContent   = '₹' + (tLent - tRepaid).toLocaleString('en-IN');
  document.getElementById('totalBorrowers').textContent = Object.keys(borrowers).length;
}

// ── View Borrower Detail Modal ──────────────────────────────
function viewBorrower(borrowerId) {
  const b       = borrowers[borrowerId];
  const bLoans  = Object.values(loans).filter(l => l.borrowerId === borrowerId);

  document.getElementById('viewBorrowerName').textContent  = b.name;
  document.getElementById('viewBorrowerPhone').textContent = b.phone || '—';
  document.getElementById('viewBorrowerNote').textContent  = b.note  || '—';

  const loansList = document.getElementById('loansList');
  loansList.innerHTML = '';

  if (bLoans.length === 0) {
    loansList.innerHTML = '<p class="text-muted text-center py-3">No loans yet.</p>';
  } else {
    bLoans.forEach(loan => {
      const outstanding = loan.amount - (loan.totalRepaid || 0);
      const isOverdue   = loan.dueDate && new Date(loan.dueDate) < new Date() && loan.status !== 'settled';
      const color       = loan.status === 'settled' ? 'success' : isOverdue ? 'danger' : loan.status === 'partial' ? 'warning' : 'secondary';
      loansList.innerHTML += `
        <div class="card mb-2 border-start border-${color} border-3">
          <div class="card-body p-3">
            <div class="d-flex justify-content-between">
              <div>
                <div class="fw-bold fs-6">₹${loan.amount.toLocaleString('en-IN')}</div>
                <div class="small text-muted">${loan.reason || 'No reason'} · ${loan.date}</div>
                ${loan.dueDate ? `<div class="small ${isOverdue ? 'text-danger fw-bold' : 'text-muted'}">📅 Due: ${loan.dueDate}</div>` : ''}
              </div>
              <div class="text-end">
                <span class="badge bg-${color} d-block mb-1">${loan.status.charAt(0).toUpperCase() + loan.status.slice(1)}</span>
                <div class="small text-muted">Repaid: ₹${(loan.totalRepaid || 0).toLocaleString('en-IN')}</div>
                <div class="small text-danger">Left: ₹${outstanding.toLocaleString('en-IN')}</div>
              </div>
            </div>
            ${loan.status !== 'settled' ? `
            <button class="btn btn-sm btn-outline-success mt-2 w-100"
              onclick="openRepaymentModal('${loan.id}', ${loan.amount}, ${loan.totalRepaid || 0})">
              💵 Add Repayment
            </button>` : `<div class="text-center text-success small mt-2">✅ Fully Settled</div>`}
          </div>
        </div>`;
    });
  }

  new bootstrap.Modal(document.getElementById('viewBorrowerModal')).show();
}

// ── Modal Openers ───────────────────────────────────────────
function openAddLoanModal(borrowerId) {
  document.getElementById('loanBorrowerId').value    = borrowerId;
  document.getElementById('loanBorrowerLabel').textContent = borrowers[borrowerId].name;
  document.getElementById('loanAmount').value  = '';
  document.getElementById('loanReason').value  = '';
  document.getElementById('loanDueDate').value = '';
  document.getElementById('loanDate').value    = new Date().toISOString().split('T')[0];
  new bootstrap.Modal(document.getElementById('addLoanModal')).show();
}

function openRepaymentModal(loanId, totalAmount, totalRepaid) {
  const outstanding = totalAmount - totalRepaid;
  document.getElementById('repaymentLoanId').value    = loanId;
  document.getElementById('repaymentMax').textContent = '₹' + outstanding.toLocaleString('en-IN');
  document.getElementById('repaymentAmount').value    = '';
  document.getElementById('repaymentNote').value      = '';
  document.getElementById('repaymentDate').value      = new Date().toISOString().split('T')[0];
  new bootstrap.Modal(document.getElementById('addRepaymentModal')).show();
}

// ── Search ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('searchInput')?.addEventListener('input', function () {
    const q = this.value.toLowerCase();
    document.querySelectorAll('#borrowerList .col-md-6').forEach(col => {
      const name = col.querySelector('.fw-bold')?.textContent.toLowerCase() || '';
      col.style.display = name.includes(q) ? '' : 'none';
    });
  });
});
