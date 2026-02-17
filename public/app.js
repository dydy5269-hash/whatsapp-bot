const API = "/api";

/* ======================
LOAD SERVICES
====================== */

async function loadServices(){

const res = await fetch(API + "/services");
const data = await res.json();

let html="";

data.forEach(s=>{

html+=`
<tr>
<td>${s.name}</td>
<td>
<button onclick="deleteService('${s.id}')">
حذف
</button>
</td>
</tr>
`;

});

document.getElementById("servicesTable").innerHTML=html;

}

/* ======================
ADD SERVICE
====================== */

async function addService(){

const name=document.getElementById("serviceName").value;

await fetch(API+"/services",{

method:"POST",
headers:{'Content-Type':'application/json'},
body:JSON.stringify({name})

});

loadServices();

}

/* ======================
LOAD TECHNICIANS
====================== */

async function loadTechnicians(){

const res=await fetch(API+"/technicians");

const data=await res.json();

let html="";

data.forEach(t=>{

html+=`
<tr>
<td>${t.name}</td>
<td>${t.phone}</td>
<td>${t.service}</td>
<td>
<button onclick="deleteTechnician('${t.id}')">
حذف
</button>
</td>
</tr>
`;

});

document.getElementById("techniciansTable").innerHTML=html;

}

/* ======================
ADD TECHNICIAN
====================== */

async function addTechnician(){

const name=document.getElementById("techName").value;
const phone=document.getElementById("techPhone").value;
const service=document.getElementById("techService").value;

await fetch(API+"/technicians",{

method:"POST",
headers:{'Content-Type':'application/json'},
body:JSON.stringify({name,phone,service})

});

loadTechnicians();

}

/* ======================
LOAD ORDERS
====================== */

async function loadOrders(){

const res=await fetch(API+"/orders");

const data=await res.json();

let html="";

data.forEach(o=>{

html+=`
<tr>
<td>${o.phone}</td>
<td>${o.service}</td>
<td>${o.status}</td>
<td>${o.technician||""}</td>
<td>
<button onclick="acceptOrder('${o.id}')">
قبول
</button>

<button onclick="rejectOrder('${o.id}')">
رفض
</button>
</td>
</tr>
`;

});

document.getElementById("ordersTable").innerHTML=html;

}

/* ======================
UPDATE ORDER
====================== */

async function acceptOrder(id){

await fetch(API+"/orders/"+id,{
method:"PUT",
headers:{'Content-Type':'application/json'},
body:JSON.stringify({status:"accepted"})
});

loadOrders();

}

async function rejectOrder(id){

await fetch(API+"/orders/"+id,{
method:"PUT",
headers:{'Content-Type':'application/json'},
body:JSON.stringify({status:"rejected"})
});

loadOrders();

}

/* ======================
AUTO LOAD
====================== */

if(document.getElementById("servicesTable"))
loadServices();

if(document.getElementById("techniciansTable"))
loadTechnicians();

if(document.getElementById("ordersTable"))
loadOrders();

