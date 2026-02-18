const firebaseConfig = {

apiKey: "YOUR_API_KEY",
authDomain: "YOUR_DOMAIN",
projectId: "YOUR_PROJECT_ID"

};

firebase.initializeApp(firebaseConfig);

async function login(){

const email = document.getElementById("email").value;
const password = document.getElementById("password").value;

await firebase.auth().signInWithEmailAndPassword(email,password);

window.location="dashboard.html";

}

function logout(){

firebase.auth().signOut();

window.location="login.html";

}
