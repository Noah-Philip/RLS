const sampleLegislators = {
  "20001": [
    {
      name: "Rep. Taylor Brooks",
      role: "U.S. House",
      phone: "(202) 555-0101",
      email: "taylor.brooks@mail.house.gov",
      committees: "Energy & Commerce, Health Subcommittee",
    },
    {
      name: "Sen. Jordan Patel",
      role: "U.S. Senate",
      phone: "(202) 555-0134",
      email: "jordan.patel@senate.gov",
      committees: "HELP, Appropriations (Labor-HHS)",
    },
  ],
  "98101": [
    {
      name: "Rep. Casey Nguyen",
      role: "U.S. House",
      phone: "(202) 555-0188",
      email: "casey.nguyen@mail.house.gov",
      committees: "Appropriations, Labor-HHS",
    },
    {
      name: "Sen. Morgan Diaz",
      role: "U.S. Senate",
      phone: "(202) 555-0199",
      email: "morgan.diaz@senate.gov",
      committees: "HELP, Aging Committee",
    },
  ],
};

const form = document.querySelector(".finder");
const results = document.getElementById("finder-results");

const renderResults = (items) => {
  if (!items || items.length === 0) {
    results.innerHTML =
      "<p>No sample data for that ZIP yet. Please try 20001 or 98101.</p>";
    return;
  }

  results.innerHTML = items
    .map(
      (item) => `
      <div class="result-item">
        <h4>${item.name} <span>${item.role}</span></h4>
        <p><strong>Phone:</strong> ${item.phone}</p>
        <p><strong>Email:</strong> ${item.email}</p>
        <p><strong>Committees:</strong> ${item.committees}</p>
      </div>
    `
    )
    .join("");
};

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const zip = document.getElementById("zip").value.trim();
  renderResults(sampleLegislators[zip]);
});

const accordionTriggers = document.querySelectorAll(".accordion-trigger");
accordionTriggers.forEach((trigger) => {
  trigger.addEventListener("click", () => {
    const isExpanded = trigger.getAttribute("aria-expanded") === "true";
    accordionTriggers.forEach((item) => {
      const panel = document.getElementById(item.getAttribute("aria-controls"));
      item.setAttribute("aria-expanded", "false");
      panel.hidden = true;
    });
    if (!isExpanded) {
      const panel = document.getElementById(trigger.getAttribute("aria-controls"));
      trigger.setAttribute("aria-expanded", "true");
      panel.hidden = false;
    }
  });
});
