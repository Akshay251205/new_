// functions:block of code that performs a specific task,can be invoked whenever needed.
// function use to reduce redundency(repeatedness).
// User defined functions:
// 1.Function defination:
// function function_name(){
//      do some work;
// }
// example:
// function myFunction(){
//     console.log("Akshay");
// }
// 2.function call:
// function_name();
// example:
// myFunction();
// ->>>>parameter->this is when function defines.
// ->>>>arguments->this is when function calls.
// example:
// function sum(a,b){
//     console.log(a+b);
// }
// sum(90,20);
// ->>>>return->return value but not print the value.
// after return anything,no more code will be executed further.
// a and b(parameters) are local variable only inside function.
// ->>>>Arrow functions:
// const functionname=(param1,param2)=>{
// do some work;
// }
// this give the function as whole to terminal or console 
// and where we can run the code by writing manually.

// example:
// const arrowsum=(a,b)=>{
//     console.log(a+b);
// }
// ->>>>>forEach loop is a method as it is associated with object (array).
// arrname.forEach(callback function)=>{
    // console.log(callbackfunction)
// }
// ->>>>callbackfunction :in javascript we can pass function as an argument also
// for that case we usee word callbackfunction.
// example:
// let arr=[1,2,3,4,5];
// arr.forEach(function printval(val){
//     console.log(val);
// })
// ->>>>array methods:
// 1.MAP:create new array with the result of some operqtions
// the value its callback returns are used to form new array.
// arr.map(callbackfn(value,index,array))
