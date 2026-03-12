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
      <div class="col-12">
        <div class="empty-state">
          <div class="empty-icon">🤝</div>
          <p class="empty-text mt-2">No borrowers yet.<br>Hit <strong>Add</strong> to get started!</p>
        </div>
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

    const badgeClass = outstanding === 0 ? 'settled' : isOverdue ? 'overdue' : 'pending';
    const badgeText  = outstanding === 0 ? 'Settled'  : isOverdue ? 'Overdue' : 'Pending';
    const initial    = b.name.charAt(0).toUpperCase();

    container.innerHTML += `
      <div class="col-md-6 col-lg-4 mb-3">
        <div class="borrower-card" onclick="viewBorrower('${b.id}')">
          <div class="d-flex justify-content-between align-items-start">
            <div class="d-flex gap-2 align-items-center">
              <div class="borrower-avatar">${initial}</div>
              <div>
                <div class="borrower-name">${b.name}</div>
                <div class="borrower-phone">${b.phone || 'No phone'}</div>
              </div>
            </div>
            <span class="badge-status badge-${badgeClass}">${badgeText}</span>
          </div>

          ${b.note ? `<div class="mt-2" style="font-size:0.75rem;color:var(--text-muted)">📝 ${b.note}</div>` : ''}

          <div class="stat-row">
            <div class="stat-row-item">
              <div class="mini-label">Lent</div>
              <div class="mini-value" style="color:var(--primary)">₹${totalLent.toLocaleString('en-IN')}</div>
            </div>
            <div class="stat-row-item">
              <div class="mini-label">Repaid</div>
              <div class="mini-value" style="color:var(--success)">₹${totalRepaid.toLocaleString('en-IN')}</div>
            </div>
            <div class="stat-row-item">
              <div class="mini-label">Due</div>
              <div class="mini-value" style="color:var(--danger)">₹${outstanding.toLocaleString('en-IN')}</div>
            </div>
          </div>

          <div class="card-footer-row">
            <button class="btn btn-primary btn-sm add"
              onclick="event.stopPropagation(); openAddLoanModal('${b.id}')"
              aria-label="Add loan for ${b.name}">
              <i class="bi bi-plus-circle" aria-hidden="true"></i> Loan
            </button>
            <button class="btn-icon"
              onclick="event.stopPropagation(); deleteBorrower('${b.id}')"
              aria-label="Delete ${b.name}">
              <i class="bi bi-trash3" aria-hidden="true"></i>
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
  const badgeClass  = loan.status === 'settled' ? 'settled' : isOverdue ? 'overdue' : loan.status === 'partial' ? 'partial' : 'pending';
  const badgeText   = isOverdue ? 'Overdue' : loan.status.charAt(0).toUpperCase() + loan.status.slice(1);

  loansList.innerHTML += `
    <div class="loan-item">
      <div class="d-flex justify-content-between align-items-start">
        <div>
          <div class="loan-item-amount">₹${loan.amount.toLocaleString('en-IN')}</div>
          <div class="loan-item-meta">${loan.reason || 'No reason'} · ${loan.date}</div>
          ${loan.dueDate ? `<div class="loan-item-due ${isOverdue ? 'text-danger fw-semibold' : ''}" style="color:var(--text-muted)">📅 Due: ${loan.dueDate}</div>` : ''}
        </div>
        <span class="badge-status badge-${badgeClass}">${badgeText}</span>
      </div>
      <div class="repay-mini-row">
        <span>Repaid: <strong style="color:var(--success)">₹${(loan.totalRepaid || 0).toLocaleString('en-IN')}</strong></span>
        <span>Left: <strong style="color:var(--danger)">₹${outstanding.toLocaleString('en-IN')}</strong></span>
      </div>
      ${loan.status !== 'settled' ? `
      <button class="btn btn-primary btn-sm w-100 mt-2"
        onclick="openRepaymentModal('${loan.id}', ${loan.amount}, ${loan.totalRepaid || 0})"
        aria-label="Add repayment for this loan">
        <i class="bi bi-cash-coin" aria-hidden="true"></i> Add Repayment
      </button>` : `
      <div class="text-center mt-2" style="font-size:0.75rem;color:var(--success);font-weight:600">
        ✓ Fully Settled
      </div>`}
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

// ── Export All Loans to PDF ─────────────────────────────────
function exportAllToPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const pageW     = doc.internal.pageSize.getWidth();
  const today     = new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
  const userName  = document.getElementById('userName').textContent || 'User';

  // ── Header ────────────────────────────────────────────────
  doc.setFillColor(13, 110, 253);
  doc.rect(0, 0, pageW, 22, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('💰 LendTrack — Loan Report', 14, 10);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(`Generated: ${today}   |   Account: ${userName}`, 14, 17);

  // ── Summary Box ───────────────────────────────────────────
  const allLoans    = Object.values(loans);
  const totalLent   = allLoans.reduce((s, l) => s + l.amount, 0);
  const totalRepaid = allLoans.reduce((s, l) => s + (l.totalRepaid || 0), 0);
  const outstanding = totalLent - totalRepaid;

  doc.setTextColor(0, 0, 0);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');

  doc.setFillColor(240, 245, 255);
  doc.roundedRect(14, 26, pageW - 28, 16, 3, 3, 'F');

  doc.setTextColor(13, 110, 253);
  doc.text(`Total Lent: Rs.${totalLent.toLocaleString('en-IN')}`, 20, 33);
  doc.setTextColor(25, 135, 84);
  doc.text(`Recovered: Rs.${totalRepaid.toLocaleString('en-IN')}`, 85, 33);
  doc.setTextColor(220, 53, 69);
  doc.text(`Outstanding: Rs.${outstanding.toLocaleString('en-IN')}`, 150, 33);
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(8);
  doc.text(`Total Borrowers: ${Object.keys(borrowers).length}`, 20, 39);

  // ── Per Borrower Tables ───────────────────────────────────
  let startY = 48;

  const borrowerList = Object.values(borrowers);

  if (borrowerList.length === 0) {
    doc.setFontSize(11);
    doc.setTextColor(100, 100, 100);
    doc.text('No borrowers found.', pageW / 2, 80, { align: 'center' });
    doc.save(`LendTrack_Report_${today.replace(/ /g,'_')}.pdf`);
    return;
  }

  borrowerList.forEach((b, index) => {
    const bLoans      = Object.values(loans).filter(l => l.borrowerId === b.id);
    const bTotalLent  = bLoans.reduce((s, l) => s + l.amount, 0);
    const bRepaid     = bLoans.reduce((s, l) => s + (l.totalRepaid || 0), 0);
    const bOutstanding = bTotalLent - bRepaid;

    // Borrower name header row
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(13, 110, 253);
    doc.text(`${index + 1}. ${b.name}`, 14, startY);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(80, 80, 80);
    const meta = [b.phone ? `📞 ${b.phone}` : '', b.note ? `📝 ${b.note}` : ''].filter(Boolean).join('   ');
    if (meta) doc.text(meta, 14, startY + 5);

    const tableStartY = meta ? startY + 8 : startY + 4;

    if (bLoans.length === 0) {
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text('No loans recorded.', 18, tableStartY + 4);
      startY = tableStartY + 10;
    } else {
      // Build table rows
      const rows = bLoans.map(loan => {
        const left = loan.amount - (loan.totalRepaid || 0);
        const isOverdue = loan.dueDate && new Date(loan.dueDate) < new Date() && loan.status !== 'settled';
        return [
          loan.date || '—',
          loan.reason || '—',
          `Rs.${loan.amount.toLocaleString('en-IN')}`,
          `Rs.${(loan.totalRepaid || 0).toLocaleString('en-IN')}`,
          `Rs.${left.toLocaleString('en-IN')}`,
          loan.dueDate || '—',
          isOverdue ? 'Overdue' : loan.status.charAt(0).toUpperCase() + loan.status.slice(1)
        ];
      });

      // Summary footer row
      rows.push([
        { content: 'TOTAL', styles: { fontStyle: 'bold' } },
        '',
        { content: `Rs.${bTotalLent.toLocaleString('en-IN')}`,    styles: { fontStyle: 'bold', textColor: [13,110,253] } },
        { content: `Rs.${bRepaid.toLocaleString('en-IN')}`,       styles: { fontStyle: 'bold', textColor: [25,135,84] } },
        { content: `Rs.${bOutstanding.toLocaleString('en-IN')}`,  styles: { fontStyle: 'bold', textColor: [220,53,69] } },
        '', ''
      ]);

      doc.autoTable({
        head: [['Date', 'Reason', 'Amount', 'Repaid', 'Outstanding', 'Due Date', 'Status']],
        body: rows,
        startY: tableStartY,
        margin: { left: 14, right: 14 },
        theme: 'grid',
        styles: {
          fontSize: 7.5,
          cellPadding: 2.5,
          overflow: 'linebreak',
          font: 'helvetica'
        },
        headStyles: {
          fillColor: [13, 110, 253],
          textColor: 255,
          fontStyle: 'bold',
          fontSize: 7.5
        },
        columnStyles: {
          0: { cellWidth: 20 },
          1: { cellWidth: 35 },
          2: { cellWidth: 25 },
          3: { cellWidth: 25 },
          4: { cellWidth: 28 },
          5: { cellWidth: 22 },
          6: { cellWidth: 22 }
        },
        didParseCell: function (data) {
          if (data.column.index === 6 && data.section === 'body' && data.row.index < rows.length - 1) {
            const status = data.cell.raw;
            if (status === 'Settled')      data.cell.styles.textColor = [25, 135, 84];
            else if (status === 'Overdue') data.cell.styles.textColor = [220, 53, 69];
            else if (status === 'Partial') data.cell.styles.textColor = [255, 153, 0];
            else                           data.cell.styles.textColor = [100, 100, 100];
          }
        },
        didDrawPage: function (data) {
          startY = data.cursor.y;
        }
      });

      startY = doc.lastAutoTable.finalY + 8;
    }

    // Add a new page if running low on space
    if (startY > 260 && index < borrowerList.length - 1) {
      doc.addPage();
      startY = 15;
    }
  });

  // ── Footer on each page ───────────────────────────────────
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.text(`LendTrack  |  Page ${i} of ${totalPages}  |  ${today}`, pageW / 2, 292, { align: 'center' });
  }

  doc.save(`LendTrack_Report_${today.replace(/ /g, '_')}.pdf`);
}
