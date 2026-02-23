// app.js
// This file runs the whole dashboard
// It loads data, checks rules, and shows results on screen
// these variables remember what the user has clicked
let selectedRule = null
let selectedTx = null
let filterMode = "all"
let stepIndex = -1

// this will hold our data after loading
let transactions = []
let featureVectors = {}
let rules = []


// -------------------------------------------------------
// LOADING DATA
// we use async/await to load json files from the server
// -------------------------------------------------------

async function loadData() {
    // fetch all three files at the same time
    const txResponse = await fetch("take_home_transactions.json")
    const fvResponse = await fetch("take_home_feature_vectors.json")
    const rulesResponse = await fetch("take_home_rules.json")

    // convert responses to javascript objects
    const txData = await txResponse.json()
    const fvData = await fvResponse.json()
    const rulesData = await rulesResponse.json()

    // save transactions array
    transactions = txData

    // feature vectors come as array so we convert to object
    // so we can look up by transaction id easily
    // before : [ { transaction_id: "TXN_001", ... }, ... ]
    // after  : { "TXN_001": { ... }, ... }
    for (let i = 0; i < fvData.length; i++) {
        let item = fvData[i]
        featureVectors[item.transaction_id] = item
    }

    // save rules array
    rules = rulesData

    // set first rule as selected by default
    selectedRule = rules[0]

    // now render everything on screen
    renderAll()
}


// -------------------------------------------------------
// CHECKING RULES
// these functions check if a transaction matches a rule
// -------------------------------------------------------

function checkOneCondition(condition, transaction, featureVector) {

    // get the value we want to check
    let actualValue = null

    if (condition.source === "raw") {
        // get value from transaction file
        actualValue = transaction[condition.field]
    } else {
        // get value from feature vector file
        if (featureVector) {
            actualValue = featureVector[condition.field]
        }
    }

    // if we could not find the value then condition fails
    if (actualValue === null || actualValue === undefined) {
        return { field: condition.field, op: condition.op, value: condition.value, actual: "NOT FOUND", pass: false, source: condition.source }
    }

    // convert to number for greater than / less than checks
    let actualNumber = parseFloat(actualValue)
    let conditionNumber = parseFloat(condition.value)

    // check the condition
    let pass = false

    if (condition.op === "==") {
        pass = String(actualValue) === String(condition.value)

    } else if (condition.op === "!=") {
        pass = String(actualValue) !== String(condition.value)

    } else if (condition.op === ">") {
        pass = actualNumber > conditionNumber

    } else if (condition.op === "<") {
        pass = actualNumber < conditionNumber

    } else if (condition.op === ">=") {
        pass = actualNumber >= conditionNumber

    } else if (condition.op === "<=") {
        pass = actualNumber <= conditionNumber

    } else if (condition.op === "contains") {
        let lowerActual = String(actualValue).toLowerCase()
        let lowerCondition = String(condition.value).toLowerCase()
        pass = lowerActual.includes(lowerCondition)

    } else if (condition.op === "out_of_hours") {
        // flag if transaction happened late night or early morning
        pass = actualNumber >= 22 || actualNumber <= 5
    }

    return { field: condition.field, op: condition.op, value: condition.value, actual: actualValue, pass: pass, source: condition.source }
}


function checkOneRule(rule, transaction) {

    let featureVector = featureVectors[transaction.transaction_id]

    // check each condition one by one
    let conditionResults = []

    for (let i = 0; i < rule.conditions.length; i++) {
        let condition = rule.conditions[i]
        let result = checkOneCondition(condition, transaction, featureVector)
        conditionResults.push(result)
    }

    // rule only fires if every single condition passed
    let allPassed = true

    for (let i = 0; i < conditionResults.length; i++) {
        if (conditionResults[i].pass === false) {
            allPassed = false
            break
        }
    }

    return {
        pass: allPassed,
        results: conditionResults
    }
}


function checkAllRules(transaction) {
    let allResults = []

    for (let i = 0; i < rules.length; i++) {
        let rule = rules[i]
        let result = checkOneRule(rule, transaction)

        allResults.push({
            rule: rule,
            pass: result.pass,
            results: result.results
        })
    }

    return allResults
}

// -------------------------------------------------------
// RENDERING
// these functions put content on the screen
// -------------------------------------------------------

function renderRules() {
    let container = document.getElementById("rules-list")
    container.innerHTML = ""

    document.getElementById("rule-count").textContent = rules.length + " rules"

    for (let i = 0; i < rules.length; i++) {
        let rule = rules[i]

        // count how many transactions this rule fires on
        let hitCount = 0
        for (let j = 0; j < transactions.length; j++) {
            let result = checkOneRule(rule, transactions[j])
            if (result.pass === true) {
                hitCount++
            }
        }

        let hitPercent = Math.round((hitCount / transactions.length) * 100)

        // pick color for severity
        let sevColor = "var(--green)"
        if (rule.severity === "Critical") sevColor = "var(--red)"
        if (rule.severity === "High") sevColor = "#e74c3c"
        if (rule.severity === "Medium") sevColor = "var(--yellow)"

        let isActive = false
        if (selectedRule && selectedRule.rule_id === rule.rule_id) {
            isActive = true
        }

        let card = document.createElement("div")
        card.className = "rule-item"
        if (isActive) {
            card.className = "rule-item active"
        }

        card.innerHTML = `
            <div class="rule-id">${rule.rule_id} · ${rule.action}</div>
            <div class="rule-name">${rule.name}</div>
            <div class="rule-meta">
                <span class="sev-tag sev-${rule.severity.toLowerCase()}">${rule.severity}</span>
                <span style="color:var(--ink3)">${rule.conditions.length} conditions</span>
                <span style="margin-left:auto; font-weight:700; color:var(--ink)">${hitCount} hits</span>
            </div>
            <div class="rule-bar">
                <div class="rule-bar-fill" style="width:${hitPercent}%; background:${sevColor}"></div>
            </div>
        `

        // use a closure to capture the correct rule value
        card.addEventListener("click", function () {
            selectedRule = rule
            selectedTx = null
            stepIndex = -1
            renderAll()
        })

        container.appendChild(card)
    }
}


function renderTable() {
    let transactionsToShow = []

    // copy all transactions first
    for (let i = 0; i < transactions.length; i++) {
        transactionsToShow.push(transactions[i])
    }

    // apply search filter
    let searchText = document.getElementById("search-input").value.toLowerCase()

    if (searchText !== "") {
        let filtered = []
        for (let i = 0; i < transactionsToShow.length; i++) {
            let tx = transactionsToShow[i]
            let idMatch = tx.transaction_id.toLowerCase().includes(searchText)
            let merchantMatch = (tx.merchant_description || "").toLowerCase().includes(searchText)
            let typeMatch = (tx.transaction_type || "").toLowerCase().includes(searchText)
            let countryMatch = (tx.merchant_country || "").toLowerCase().includes(searchText)

            if (idMatch || merchantMatch || typeMatch || countryMatch) {
                filtered.push(tx)
            }
        }
        transactionsToShow = filtered
    }

    // evaluate selected rule against all transactions
    let evaluationResults = {}
    for (let i = 0; i < transactions.length; i++) {
        let tx = transactions[i]
        if (selectedRule) {
            evaluationResults[tx.transaction_id] = checkOneRule(selectedRule, tx)
        } else {
            evaluationResults[tx.transaction_id] = null
        }
    }

    // apply pass or fail filter
    if (filterMode === "pass") {
        let filtered = []
        for (let i = 0; i < transactionsToShow.length; i++) {
            let tx = transactionsToShow[i]
            if (evaluationResults[tx.transaction_id] && evaluationResults[tx.transaction_id].pass === true) {
                filtered.push(tx)
            }
        }
        transactionsToShow = filtered
    }

    if (filterMode === "fail") {
        let filtered = []
        for (let i = 0; i < transactionsToShow.length; i++) {
            let tx = transactionsToShow[i]
            if (!evaluationResults[tx.transaction_id] || evaluationResults[tx.transaction_id].pass === false) {
                filtered.push(tx)
            }
        }
        transactionsToShow = filtered
    }

    // count pass and fail for header stats
    let passCount = 0
    let failCount = 0
    for (let i = 0; i < transactions.length; i++) {
        let tx = transactions[i]
        if (evaluationResults[tx.transaction_id] && evaluationResults[tx.transaction_id].pass === true) {
            passCount++
        } else {
            failCount++
        }
    }

    document.getElementById("stat-pass").textContent = passCount + " pass"
    document.getElementById("stat-fail").textContent = failCount + " fail"
    document.getElementById("stat-total").textContent = transactions.length + " total"

    // build the table rows
    let tableBody = document.getElementById("tx-table-body")
    tableBody.innerHTML = ""

    for (let i = 0; i < transactionsToShow.length; i++) {
        let tx = transactionsToShow[i]
        let evalResult = evaluationResults[tx.transaction_id]

        // build the status pill text
        let statusPill = ""

        if (evalResult) {
            let passedCount = 0
            for (let j = 0; j < evalResult.results.length; j++) {
                if (evalResult.results[j].pass === true) {
                    passedCount++
                }
            }
            let totalCount = evalResult.results.length

            if (evalResult.pass === true) {
                statusPill = `<span class="status-pill pill-pass">● FIRES</span>`
            } else if (passedCount > 0) {
                statusPill = `<span class="status-pill pill-partial">◐ ${passedCount}/${totalCount}</span>`
            } else {
                statusPill = `<span class="status-pill pill-fail">● miss</span>`
            }
        }

        // shorten the date to just month-day hour:min
        let shortDate = ""
        if (tx.txn_date_time) {
            shortDate = tx.txn_date_time.substring(5, 16)
        }

        let row = document.createElement("tr")

        if (selectedTx && selectedTx.transaction_id === tx.transaction_id) {
            row.className = "selected"
        }

        row.innerHTML = `
            <td style="color:var(--blue); font-size:9px; font-family:var(--mono)">${tx.transaction_id}</td>
            <td style="font-size:9px; font-family:var(--mono)">${shortDate}</td>
            <td class="amount" style="font-family:var(--mono)">$${tx.amount}</td>
            <td style="font-size:9px; font-family:var(--mono)">${tx.currency}</td>
            <td style="font-size:10px">${tx.transaction_type}</td>
            <td style="max-width:140px; overflow:hidden; text-overflow:ellipsis; font-size:10px">${tx.merchant_description}</td>
            <td style="font-size:9px; font-family:var(--mono)">${tx.merchant_country}</td>
            <td>${statusPill}</td>
        `

        row.addEventListener("click", function () {
            selectedTx = tx
            stepIndex = -1

            // remove selected from all rows
            let allRows = tableBody.querySelectorAll("tr")
            for (let k = 0; k < allRows.length; k++) {
                allRows[k].classList.remove("selected")
            }

            row.classList.add("selected")
            renderInspector()
        })

        tableBody.appendChild(row)
    }
}


function renderInspector() {
    let inspectorBody = document.getElementById("inspector-body")
    let ruleBadge = document.getElementById("inspector-rule-badge")

    // show empty state if nothing is selected
    if (!selectedTx) {
        inspectorBody.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">◎</div>
                <div>Select a transaction</div>
                <div style="font-size:9px; margin-top:4px">Click any row to inspect</div>
            </div>`
        ruleBadge.textContent = "no selection"
        return
    }

    if (selectedRule) {
        ruleBadge.textContent = selectedRule.rule_id
    } else {
        ruleBadge.textContent = "no rule"
    }

    let featureVector = featureVectors[selectedTx.transaction_id]
    let activeEvaluation = null

    if (selectedRule) {
        activeEvaluation = checkOneRule(selectedRule, selectedTx)
    }

    let allEvaluations = checkAllRules(selectedTx)

    let html = `<div class="anim-in">`

    // transaction header
    html += `
        <div class="insp-tx-header">
            <div class="insp-tx-id">${selectedTx.transaction_id}</div>
            <div class="insp-tx-sub">
                ${selectedTx.txn_date_time} · ${selectedTx.merchant_country} · ${selectedTx.transaction_type}
            </div>
        </div>`

    // show conditions for the selected rule
    if (selectedRule && activeEvaluation) {

        html += `<div class="section-label">${selectedRule.name}</div>`

        for (let i = 0; i < activeEvaluation.results.length; i++) {
            let result = activeEvaluation.results[i]

            // show which file this field comes from
            let sourceTag = ""
            if (result.source === "raw") {
                sourceTag = `<span class="cond-source src-raw">transactions</span>`
            } else {
                sourceTag = `<span class="cond-source src-feat">feature_vectors</span>`
            }

            // check if this is the current highlighted step
            let extraClass = ""
            if (stepIndex === i) {
                extraClass = "step-active"
            }

            let passClass = "fail"
            if (result.pass === true) {
                passClass = "pass"
            }

            let icon = "✗"
            if (result.pass === true) {
                icon = "✓"
            }

            html += `
                <div class="condition-row ${passClass} ${extraClass}" id="cond-row-${i}">
                    <span class="cond-icon">${icon}</span>
                    <div class="cond-body">
                        <div class="cond-expr">
                            <span class="cond-field">${result.field}</span>
                            <span class="cond-op">${result.op}</span>
                            <span class="cond-val">${result.value}</span>
                            ${sourceTag}
                        </div>
                        <div class="cond-actual">
                            actual value → <span class="cond-actual-val">${result.actual}</span>
                        </div>
                    </div>
                </div>`
        }

        // count how many conditions passed
        let passedCount = 0
        for (let i = 0; i < activeEvaluation.results.length; i++) {
            if (activeEvaluation.results[i].pass === true) {
                passedCount++
            }
        }
        let totalCount = activeEvaluation.results.length

        // show verdict
        let verdictClass = "verdict-fail"
        let verdictText = "● RULE DOES NOT FIRE"
        if (activeEvaluation.pass === true) {
            verdictClass = "verdict-pass"
            verdictText = "● RULE FIRES"
        }

        html += `
            <div class="verdict-box ${verdictClass}">
                <span>${verdictText}</span>
                <span style="font-size:9px; opacity:0.7">${passedCount} / ${totalCount} conditions met</span>
            </div>`

        // step debugger buttons
        let prevDisabled = ""
        if (stepIndex <= 0) {
            prevDisabled = "disabled"
        }

        let nextDisabled = ""
        if (stepIndex >= totalCount - 1) {
            nextDisabled = "disabled"
        }

        html += `<div class="step-hint">Click Next to go through each condition one by one ↓</div>`
        html += `
            <div class="step-controls">
                <button class="step-btn" id="btn-prev" onclick="goToPrevStep()" ${prevDisabled}>← Prev</button>
                <button class="step-btn" id="btn-next" onclick="goToNextStep()" ${nextDisabled}>Next →</button>
                <button class="step-btn primary" onclick="resetStepDebugger()">Reset</button>
            </div>`
    }

    html += `<div class="divider"></div>`

    // feature vector section
    html += `<div class="section-label"><span class="tag-feat">FEATURE VECTORS</span> Computed fields</div>`
    html += `<div class="feature-grid">`

    if (featureVector) {
        let keys = Object.keys(featureVector)
        for (let i = 0; i < keys.length; i++) {
            let key = keys[i]
            let value = featureVector[key]
            html += `
                <div class="feature-cell">
                    <div class="feature-key">${key}</div>
                    <div class="feature-val">${value}</div>
                </div>`
        }
    } else {
        html += `
            <div class="feature-cell" style="grid-column:span 2">
                <div class="feature-key" style="color:var(--red)">No feature vector found for this transaction</div>
            </div>`
    }

    html += `</div>`

    // raw transaction fields
    html += `<div class="section-label"><span class="tag-raw">TRANSACTIONS</span> Raw fields</div>`
    html += `<div class="feature-grid">`

    let fieldsToShow = ["amount", "currency", "transaction_type", "merchant_country", "merchant_city", "merchant_description"]

    for (let i = 0; i < fieldsToShow.length; i++) {
        let field = fieldsToShow[i]
        html += `
            <div class="feature-cell">
                <div class="feature-key">${field}</div>
                <div class="feature-val" style="font-size:9px; word-break:break-all">${selectedTx[field]}</div>
            </div>`
    }

    html += `</div>`

    // all rules vs this transaction
    html += `<div class="section-label">All rules vs. this transaction</div>`
    html += `<div class="all-rules-list">`

    for (let i = 0; i < allEvaluations.length; i++) {
        let evaluation = allEvaluations[i]

        let firesClass = ""
        if (evaluation.pass === true) {
            firesClass = "fires"
        }

        let firesText = "○ miss"
        let firesColor = "var(--ink3)"
        if (evaluation.pass === true) {
            firesText = "● FIRES"
            firesColor = "var(--red)"
        }

        html += `
            <div class="all-rule-row ${firesClass}" onclick="switchToRule('${evaluation.rule.rule_id}')">
                <span style="color:var(--ink2)">${evaluation.rule.name}</span>
                <span style="color:${firesColor}; font-weight:700">${firesText}</span>
            </div>`
    }

    html += `</div></div>`

    inspectorBody.innerHTML = html
}

// STEP DEBUGGER

function goToNextStep() {
    if (!selectedRule || !selectedTx) return

    let lastIndex = selectedRule.conditions.length - 1

    if (stepIndex < lastIndex) {
        stepIndex = stepIndex + 1
    }

    renderInspector()

    // scroll to the highlighted condition
    setTimeout(function () {
        let conditionEl = document.getElementById("cond-row-" + stepIndex)
        if (conditionEl) {
            conditionEl.scrollIntoView({ behavior: "smooth", block: "nearest" })
        }
    }, 50)
}


function goToPrevStep() {
    if (!selectedRule || !selectedTx) return

    if (stepIndex > 0) {
        stepIndex = stepIndex - 1
    }

    renderInspector()

    setTimeout(function () {
        let conditionEl = document.getElementById("cond-row-" + stepIndex)
        if (conditionEl) {
            conditionEl.scrollIntoView({ behavior: "smooth", block: "nearest" })
        }
    }, 50)
}


function resetStepDebugger() {
    stepIndex = -1
    renderInspector()
}


function switchToRule(ruleId) {
    for (let i = 0; i < rules.length; i++) {
        if (rules[i].rule_id === ruleId) {
            selectedRule = rules[i]
            break
        }
    }
    stepIndex = -1
    renderAll()
}
// MATRIX VIEW
function renderMatrix() {
    let html = `<div style="overflow-x:auto">
        <table class="matrix-table" style="border-collapse:collapse">
            <thead>
                <tr>
                    <th style="text-align:left; padding:5px 10px">TXN ID</th>`

    for (let i = 0; i < rules.length; i++) {
        html += `<th title="${rules[i].name}">${rules[i].rule_id}</th>`
    }

    html += `<th>Total Fires</th></tr></thead><tbody>`

    for (let i = 0; i < transactions.length; i++) {
        let tx = transactions[i]

        let ruleResults = []
        for (let j = 0; j < rules.length; j++) {
            ruleResults.push(checkOneRule(rules[j], tx))
        }

        let totalFires = 0
        for (let j = 0; j < ruleResults.length; j++) {
            if (ruleResults[j].pass === true) {
                totalFires++
            }
        }

        html += `<tr><td class="tx-id" style="text-align:left">${tx.transaction_id}</td>`

        for (let j = 0; j < ruleResults.length; j++) {
            if (ruleResults[j].pass === true) {
                html += `<td class="hit">●</td>`
            } else {
                html += `<td class="miss">·</td>`
            }
        }

        let totalColor = "var(--ink3)"
        if (totalFires > 0) {
            totalColor = "var(--red)"
        }

        html += `
            <td style="font-family:var(--mono); font-size:9px; font-weight:700; color:${totalColor}">
                ${totalFires}
            </td></tr>`
    }

    html += `</tbody></table></div>`
    html += `
        <div style="margin-top:16px; font-family:var(--mono); font-size:9px; color:var(--ink3)">
            <span style="color:var(--red); font-weight:700">●</span> Rule fires on this transaction
            &nbsp;&nbsp;
            <span>·</span> Rule does not fire
        </div>`

    document.getElementById("matrix-content").innerHTML = html
}

function renderStats() {
    let html = `<div class="stats-grid">`

    for (let i = 0; i < rules.length; i++) {
        let rule = rules[i]

        // find flagged transactions
        let flaggedTransactions = []
        for (let j = 0; j < transactions.length; j++) {
            let result = checkOneRule(rule, transactions[j])
            if (result.pass === true) {
                flaggedTransactions.push(transactions[j])
            }
        }

        let hitPercent = Math.round((flaggedTransactions.length / transactions.length) * 100)

        // add up total amount
        let totalAmount = 0
        for (let j = 0; j < flaggedTransactions.length; j++) {
            totalAmount = totalAmount + flaggedTransactions[j].amount
        }

        let sevColor = "var(--green)"
        if (rule.severity === "Critical") sevColor = "var(--red)"
        if (rule.severity === "High") sevColor = "#e74c3c"
        if (rule.severity === "Medium") sevColor = "var(--yellow)"

        html += `
            <div class="stat-card">
                <div class="stat-card-rule">
                    ${rule.rule_id} · <span style="color:${sevColor}">${rule.severity}</span> · ${rule.action}
                </div>
                <div class="stat-card-name">${rule.name}</div>
                <div class="stat-card-nums">
                    <div>
                        <div class="stat-num-label">HIT RATE</div>
                        <div class="stat-num-val" style="color:${sevColor}">${hitPercent}%</div>
                    </div>
                    <div>
                        <div class="stat-num-label">FLAGGED</div>
                        <div class="stat-num-val">${flaggedTransactions.length}</div>
                    </div>
                    <div>
                        <div class="stat-num-label">TOTAL $</div>
                        <div class="stat-num-val">$${totalAmount.toFixed(0)}</div>
                    </div>
                </div>
                <div class="stat-bar">
                    <div class="stat-bar-fill" style="width:${hitPercent}%; background:${sevColor}"></div>
                </div>
            </div>`
    }

    html += `</div>`
    document.getElementById("stats-content").innerHTML = html
}

function setFilter(mode) {
    filterMode = mode

    document.getElementById("filter-all").classList.remove("active")
    document.getElementById("filter-pass").classList.remove("active")
    document.getElementById("filter-fail").classList.remove("active")

    document.getElementById("filter-" + mode).classList.add("active")

    renderTable()
}

function switchView(view) {
    document.getElementById("main-app").style.display = "none"
    document.getElementById("matrix-view").style.display = "none"
    document.getElementById("stats-view").style.display = "none"

    if (view === "debug") document.getElementById("main-app").style.display = "grid"
    if (view === "matrix") document.getElementById("matrix-view").style.display = "block"
    if (view === "stats") document.getElementById("stats-view").style.display = "block"

    // update active tab button
    let buttons = document.querySelectorAll(".tab-btn")
    for (let i = 0; i < buttons.length; i++) {
        buttons[i].classList.remove("active")
    }

    let viewNames = ["debug", "matrix", "stats"]
    for (let i = 0; i < viewNames.length; i++) {
        if (viewNames[i] === view) {
            buttons[i].classList.add("active")
        }
    }

    if (view === "matrix") renderMatrix()
    if (view === "stats") renderStats()
}

function renderAll() {
    renderRules()
    renderTable()
    renderInspector()
}
loadData()