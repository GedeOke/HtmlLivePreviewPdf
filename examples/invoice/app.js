const currency = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

const date = new Intl.DateTimeFormat("id-ID", {
  day: "2-digit",
  month: "long",
  year: "numeric",
});

const statusLabels = {
  paid: "Lunas",
  unpaid: "Belum dibayar",
  overdue: "Lewat jatuh tempo",
};

async function loadInvoice() {
  const invoice = document.querySelector(".invoice");
  const errorMessage = document.querySelector("#error-message");

  try {
    // Ganti URL ini dengan endpoint API internal jika diperlukan.
    const response = await fetch("./invoice-data.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`API mengembalikan HTTP ${response.status}`);
    }

    const data = await response.json();
    renderCompany(data.company);
    renderCustomer(data.customer);
    renderMetadata(data);
    renderItems(data.items);
    renderTotals(data);
    renderPayment(data.payment, data.notes);
    invoice.dataset.htmlPdfReady = "true";
  } catch (error) {
    errorMessage.hidden = false;
    errorMessage.textContent = `Invoice gagal dimuat: ${getErrorMessage(error)}`;
  } finally {
    invoice.setAttribute("aria-busy", "false");
    // Dapat dipakai dengan setting htmlLivePdf.readyMode = "windowFlag".
    window.__HTML_LIVE_PDF_READY__ = true;
  }
}

function renderCompany(company) {
  setText("company-name", company.name);
  setText("company-tagline", company.tagline);
  setText("company-contact", `${company.email} · ${company.phone} · ${company.website}`);
}

function renderCustomer(customer) {
  setText("customer-name", customer.name);
  setText("customer-company", customer.company);
  setText("customer-address", customer.address);
  setText("customer-email", customer.email);
}

function renderMetadata(data) {
  setText("invoice-number", data.invoiceNumber);
  setText("issue-date", formatDate(data.issueDate));
  setText("due-date", formatDate(data.dueDate));
  setText("project-name", data.projectName);

  const status = document.querySelector("#status");
  status.textContent = statusLabels[data.status] ?? data.status;
  status.dataset.status = data.status;
}

function renderItems(items) {
  const tbody = document.querySelector("#invoice-items");
  tbody.replaceChildren(
    ...items.map((item) => {
      const row = document.createElement("tr");
      row.append(
        cellWithDescription(item.name, item.description),
        textCell(String(item.quantity), "number-column"),
        textCell(currency.format(item.unitPrice), "number-column"),
        textCell(currency.format(item.quantity * item.unitPrice), "number-column"),
      );
      return row;
    }),
  );
}

function renderTotals(data) {
  const subtotal = data.items.reduce(
    (total, item) => total + item.quantity * item.unitPrice,
    0,
  );
  const discount = data.discount ?? 0;
  const taxable = subtotal - discount;
  const tax = taxable * data.taxRate;
  const grandTotal = taxable + tax;

  setText("subtotal", currency.format(subtotal));
  setText("tax-label", `PPN ${Math.round(data.taxRate * 100)}%`);
  setText("tax", currency.format(tax));
  setText("grand-total", currency.format(grandTotal));

  if (discount > 0) {
    document.querySelector("#discount-row").hidden = false;
    setText("discount", `−${currency.format(discount)}`);
  }
}

function renderPayment(payment, notes) {
  setText("notes", notes);
  setText("bank-name", payment.bank);
  setText("bank-account", payment.accountNumber);
  setText("account-holder", `a.n. ${payment.accountHolder}`);
}

function cellWithDescription(name, description) {
  const cell = document.createElement("td");
  const title = document.createElement("strong");
  const detail = document.createElement("small");
  title.textContent = name;
  detail.textContent = description;
  cell.append(title, detail);
  return cell;
}

function textCell(value, className) {
  const cell = document.createElement("td");
  cell.className = className;
  cell.textContent = value;
  return cell;
}

function setText(id, value) {
  document.querySelector(`#${id}`).textContent = value;
}

function formatDate(value) {
  return date.format(new Date(`${value}T00:00:00+07:00`));
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

void loadInvoice();
