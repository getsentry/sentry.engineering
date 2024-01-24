---
title: "Getting Started with Jetpack Compose"
date: '2023-02-15'
tags: ['mobile','jetpack compose','android']
draft: false
summary: Jetpack Compose, a new declarative UI toolkit by Google made for building native Android apps, is rapidly gaining traction. The main advantage of using Jetpack Compose is that it allows you to write UI code that is more concise and easier to understand. This leads to improved maintainability and reduced development time. The main advantage of using Jetpack Compose is that it allows you to write UI code that is more concise and easier to understand. This leads to improved maintainability and reduced development time.
images: [/images/getting-started-with-jetpack-compose/jetpackcompose-hero.jpg]
layout: PostLayout
canonicalUrl: https://blog.sentry.io/2023/02/15/getting-started-with-jetpack-compose/
authors: ['lazarnikolov']
---

Recently, we wrote about the [demonstrative move to declarative UI](/blog/mobile-the-future-is-declarative/). With [Jetpack Compose](http://d.android.com/compose), Android is joining the declarative trends.

Jetpack Compose, a new declarative UI toolkit by Google made for building native Android apps, is rapidly gaining traction. In fact, as announced at the [Android Dev Summit](https://www.youtube-nocookie.com/watch?t=1069&v=Awi4J5-tbW4&feature=youtu.be) last year last year, 160 of the top 1,000 Android apps already use Jetpack Compose. In contrast to the traditional XML Views, Jetpack Compose allows you to build UIs using composable functions that describe how the UI should look and behave.

The main advantage of using Jetpack Compose is that it allows you to write UI code that is more concise and easier to understand. This leads to improved maintainability and reduced development time.

The main disadvantage of using Jetpack Compose is that it’s relatively new, so its ecosystem is limited and the number of available libraries, tools, and resources is lower than the traditional ecosystem.

Despite that, we believe that learning Jetpack Compose is worth the learning curve and challenges. Here are some tips we’ve found helpful as you are getting started.

## How to start using Jetpack Compose
The recommended IDE for working with Jetpack Compose is [Android Studio](https://developer.android.com/studio). After downloading and installing Android Studio, you’ll get the option to create a new project. To create a new Jetpack Compose application, you need to select either the ```Empty Compose Activity``` (which uses Material v2), or ```Empty Compose Activity (Material3)``` (which uses the Material v3 which is in version 1.0 as of last year). You can see both options in the top right of this screenshot:

![Project selector for Jetpack Compose](/images/getting-started-with-jetpack-compose/jetpack-compose.png)

This is the easiest way to get started with Jetpack Compose. If you’d like to enable Jetpack Compose into an existing Android application, here’s what you need to do:

1. Add the following build configurations in your app’s ```build.gradle``` file:

```java
 android {
    buildFeatures {
        // this flag enables Jetpack Compose
        compose true
    }

    composeOptions {
        // the compiler version should match
        // your project's Kotlin version
        kotlinCompilerExtensionVersion = "1.3.2"
    }
}
```

2. Add the Compose BOM ([Bill of Materials](https://developer.android.com/jetpack/compose/bom/bom)) and the subset of Compose dependencies to your dependencies:

```java
 dependencies {
    def composeBom = platform('androidx.compose:compose-bom:2023.01.00')
    implementation composeBom
    androidTestImplementation composeBom

    // Choose one of the following:
    // Material Design 3
    implementation 'androidx.compose.material3:material3'
    // or Material Design 2
    implementation 'androidx.compose.material:material'
    // or skip Material Design and build directly on top of foundational components
    implementation 'androidx.compose.foundation:foundation'
    // or only import the main APIs for the underlying toolkit systems,
    // such as input and measurement/layout
    implementation 'androidx.compose.ui:ui'       

    // Android Studio Preview support
    implementation 'androidx.compose.ui:ui-tooling-preview'
    debugImplementation 'androidx.compose.ui:ui-tooling'

    // UI Tests
    androidTestImplementation 'androidx.compose.ui:ui-test-junit4'
    debugImplementation 'androidx.compose.ui:ui-test-manifest'

    // Optional - Included automatically by material, only add when you need
    // the icons but not the material library (e.g. when using Material3 or a
    // custom design system based on Foundation)
    implementation 'androidx.compose.material:material-icons-core'
    // Optional - Add full set of material icons
    implementation 'androidx.compose.material:material-icons-extended'
    // Optional - Add window size utils
    implementation 'androidx.compose.material3:material3-window-size-class'

    // Optional - Integration with activities
    implementation 'androidx.activity:activity-compose:1.5.1'
    // Optional - Integration with ViewModels
    implementation 'androidx.lifecycle:lifecycle-viewmodel-compose:2.5.1'
    // Optional - Integration with LiveData
    implementation 'androidx.compose.runtime:runtime-livedata'
    // Optional - Integration with RxJava
    implementation 'androidx.compose.runtime:runtime-rxjava2'

}
```

## How do you build UI in Jetpack Compose?
Jetpack Compose uses Composables to define the view hierarchy, and modifier to apply visual appearance and behavior changes to the composables they’re added to.

### Composable functions
Composable functions (or just Composables) are ordinary Kotlin functions that are annotated with ```@Composable```, can be nested within another composable functions, and return a hierarchy of other composables in order to define their UI. Let’s see a simple composable that defines a contact row UI that contains a user photo, and a name and phone number:

```java
@Composable
fun ContactRow(user: User) {
	Row {
		Image (
			painter = painterResource(id = R.drawable.user),
			contentDescription = "A photo of a user"
		)

		Column {
			Text(user.name)
			Text(user.phone)
		}
	}
}
```

The ```Row``` composable is a layout composable that renders its children one next to another. The ```Image``` composable is the first child which is going to render the ```user``` drawable. Then we have the ```Column``` composable which, similar to the ```Row```, is a layout composable, but it renders its children one below another. The children of the ```Column``` composable are two ```Text``` composables that render the user’s name and phone number.

### Modifiers
Modifiers are used to change the visual appearance and behavior of the composables they’re added to. We use modifiers when we want to change UI elements such as the size of the composable (width, height), the padding, background, or alignment.

Modifiers can also be stacked on top of each other, allowing us to modify multiple visual properties. Here’s an example of how we can set the padding and max width of the Contact row from the previous snippet:

```java
@Composable
fun ContactRow(user: User) {
	Row(modifier = Modifier.fillMaxWidth().padding(16.dp)) {
		...
	}
}
```

## How do you interact with data in Jetpack Compose?
There are multiple ways to keep data within your Jetpack Compose app: [MutableState](https://volcano-bovid-81c.notion.site/Getting-Started-with-Jetpack-Compose-7187d91a2f0c4e56969db56c51c91ec1), [LiveData](https://volcano-bovid-81c.notion.site/Getting-Started-with-Jetpack-Compose-7187d91a2f0c4e56969db56c51c91ec1), and [StateFlow](https://volcano-bovid-81c.notion.site/Getting-Started-with-Jetpack-Compose-7187d91a2f0c4e56969db56c51c91ec1).

### MutableState
In Jetpack Compose, state management can be accomplished by using the ```remember``` API to store an object in memory, and the ```mutableStateOf``` to declare a state variable. We can store both mutable and immutable objects. The ```mutableStateOf``` creates an observable ```MutableState<T>```, which is an observable type.

```java
interface MutableState<T> : State<T> {
    override var value: T
}
```

Any changes to value ```schedules``` a recomposition (re-rendering) of any composable functions that read it. There are three ways to declare a ```MutableState``` object:

* ```val mutableState = remember { mutableStateOf(0) }```
* ```var value by remember { mutableStateOf(false) }```
* ```val (value, setValue) = remember { mutableStateOf("Hello, Compose!") }```

### LiveData
LiveData is a data holder class that can be observed within a given lifecycle, meaning it respects the lifecycle of other app components, such as activities, fragments, or services. This ensures LiveData only updates observers that are in an active lifecycle state, which also ensures no memory leaks happen within your app.

Let’s see an example of working with LiveData:

1. You need to create an instance of the ```LiveData``` class to hold a certain type of data, which is usually done within your [ViewModel](https://developer.android.com/reference/androidx/lifecycle/ViewModel) class (use ```MutableLiveData``` if you’d like to update the value at some point):

```java
class HomeViewModel : ViewModel() {
	// Create a MutableLiveData instance that keeps a string
	val userName = MutableLiveData<String>()
}
```

2. Obtain the value in your composable by calling the ```observeAsState``` method:

```java
@Composable
fun HomeScreen (viewModel: HomeViewModel = viewModel())   {
	// Create an observer of the state of userName
	val userName = viewModel.userName.observeAsState()

	// Use the value in your UI
	Column {
		Text(userName)
	}
}
```

3. To update ```userName```’s value (also usually done in the view model), create a function that sets the new ```value``` to its value property:

```java
fun updateUserName(newName: String) {
	userName.value = newName
}
```

4. You’d use the new function in your Compose file as ```viewModel.updateUserName("...")```.

### StateFlow
StateFlow is a newer alternative to LiveData. Both have similarities, and both are observable. Here’s how you can work with StateFlow in Jetpack Compose:

1. Create an instance of ```StateFlow``` to hold a certain type of data (use ```MutableStateFlow``` if you’d like to update the value at some point)

```java
class HomeViewModel : ViewModel() {
    // Create a MutableStateFlow instance that keeps a string
    val userName = MutableStateFlow<String>()
}
```

2. Obtain the value in your composable by calling the ```collectAsState``` method:

```java
@Composable
fun HomeScreen (viewModel: HomeViewModel = viewModel())   {
	// Create an observer to collect the state of userName
	val userName = viewModel.userName.collectAsState()

	// Use the value in your UI
	Column {
		Text(userName)
	}
}
```

3. To update ```userName```’s value (also usually done in the view model), create a function that sets the new value to its ```value``` property:

```java
fun updateUserName(newName: String) {
	userName.value = newName
}
```

4. You’d use the new function in your Compose file as ```viewModel.updateUserName("...")```.

## What are the best practices for Jetpack Compose?
Aside from the official best practices documentation, we’ve got a few additional tips that would make your codebase safer and easier to work in.

### Code organization
Every developer or organization has their own opinions on how a project should be structured. There is no “right” or “wrong” way to do it. Okay, maybe it’s wrong to put every file in one single directory 😅. Here’s an example structure to help you get started, which you can modify and evolve as your project grows:

```bash
.
├─ 📁 **ui** (to keep all your UI related things)
|	 ├─ 📁 **screens** (where you define your screens composables and their corresponding view models)
|	 |  └─ 📁 **home**
|	 |     ├─ 📝 **HomeScreen.kt** (the UI for the Home screen)
|	 |     └─ 📝 **HomeViewModel.kt** (the view model for the Home screen)
|	 ├─ 📁 **components** (where you define components that are shared across multiple screens)
|	 |  └─ 📝 **UserList.kt**
|  └─ 📁 **theme** (where you keep your theme definition and design tokens)
|     ├─ 📝 **Colors.kt**
|     ├─ 📝 **Shapes.kt**
|     ├─ 📝 **Theme.kt**
|     └─ 📝 **Typography.kt**
├─ 📁 **utils** (where you keep your various utility functions, like data converters etc...)
|  └─ 📝 **DateUtils.kt** 
└─ 📝 **MainActivity.kt** (this is your default MainActivity)
```

### Avoid creating “god” files
“God” files are a big no-no. They’re files that contain all code associated with them: UI, domain, business logic, utility functions etc… It might be easier putting everything into one file, but maintaining that would get harder and harder as you add functionalities. The solution to this is using a proper architecture in your Jetpack Compose app.

There are multiple architectures that you can use, all with their own pros and cons. The most common one in Jetpack Compose is MVVM, abbreviated from Model-View-ViewModel, because Jetpack Compose has a first-class [ViewModel](https://developer.android.com/topic/libraries/architecture/viewmodel) implementation.

### Stay true to the MVVM
As you saw from the previous examples, Jetpack Compose has a first-class [ViewModel](https://developer.android.com/topic/libraries/architecture/viewmodel) implementation. The MVVM, or Model-View-ViewModel, is a software design pattern that is structured to separate business logic from the UI. That means, your UI should not handle state updates, but it should let the view model do that by sending it user actions.

Let’s explore that with an example. Remember the ```MutableStateFlow``` example from before? That example was oversimplified on purpose, but in a real-world project you would never expose a ```MutableStateFlow``` from your ```ViewModel```, but just a ```StateFlow```. In order to make that work, you should define a private ```MutableStateFlow``` variable and a public ```StateFlow``` variable that returns the mutable flow by invoking the ```asStateFlow()``` method.

```java
class HomeViewModel : ViewModel() {
	// Create a private MutableStateFlow instance that keeps a string
	private val _userName = MutableStateFlow<String>()

	// Create a public StateFlow that returns the MutableStateFlow as immutable
	val userName: StateFlow<String> = _userName.asStateFlow()
}
```

With this simple change, we’re preventing the UI from being able to change the state. But, how do we actually change the state? We’ll expose a function from the view model that does that!

```java
class HomeViewModel : ViewModel() {
	private val _userName = MutableStateFlow<String>()
	val userName: StateFlow<String> = _userName.asStateFlow()

	// Create a public function that updates the private MutableStateFlow value
	fun setUserName(newName: String) {
		_userName.value = newName
	}
}
```

So now the UI has an immutable `StateFlow` that it can observe, and a function to update its value. The business logic lives inside of the view model, while the Composable is only responsible to react to state changes and send user actions to the view model.

### Don’t create a thousand flows
So you’ve learned how to create state flows. Great! Would you repeat the same for every state variable you need in your UI? Please don’t 😅 To avoid that, you can create a `data class` that keeps all of the values of your state, and create a single flow that uses it.

Let’s learn this with an example. If we wanted to also keep the user’s phone number, email and address, we can create a data class called `HomeScreenState` that contains all those values:

```java
data class HomeScreenState(
	val userName: String = ""
	val userPhone: String = ""
	val userEmail: String = ""
	val userAddress: String = ""
)
```

Then we would refactor our view model to use the new `HomeScreenState` instead of a `String`:

```java
class HomeViewModel : ViewModel() {
	private val _uiState = MutableStateFlow<HomeScreenState>()
	val uiState: StateFlow<HomeScreenState> = _uiState.asStateFlow()

	// ...
}
```

And then we can use all of the values in our composable by `viewModel.uiState.userName`. If we also wanted to be able to update all those values, we would create functions for each of them in our view model:

```java
class HomeViewModel : ViewModel() {
	private val _uiState = MutableStateFlow<HomeScreenState>()
	val uiState: StateFlow<HomeScreenState> = _uiState.asStateFlow()

	fun updateUserName(newName: String) {
		_uiState.update {
			it.copy(
				userName = newName
			)
		}
	}

	fun updateUserEmail(newEmail: String) {
			_uiState.update {
				it.copy(
					userEmail = newEmail
				)
			}
		}
	}

	// ...

}
```

### Keep a close eye on your errors and performance in production
As you’re getting acclimated to Jetpack Compose, an error and performance monitoring tool can be really helpful to reduce your learning curve and ensure that your app is bug-free. Jetpack Compose does a lot of heavy lifting for developers – as a declarative toolkit, developers need to write less code to describe their UI, and Jetpack Compose takes care of the rest. But it does abstract away a lot of code, making it difficult to identify errors.

[Sentry](https://sentry.io/for/android/) offers an out-of-the-box integration that can help you build a better Jetpack Compose app. The integration gives precise context to reduce troubleshooting time with transactions and breadcrumbs. Keep an eye on all the issues and crashes your app is experiencing in production, with a lot of context as to why the issue happened, the exact line of code that triggered it, and all sorts of hardware and software info of the device it ran.

![Sentry showing a Jetpack Compose error](/images/getting-started-with-jetpack-compose/jetpack-compose-error.png)

## Conclusion
I’d totally understand if you’re feeling overwhelmed by now, but let’s do a quick recap! We’ve learned how to create a new Jetpack Compose project, and that Jetpack Compose uses Composables and Modifiers to define the view hierarchy and apply visual changes. Data in Jetpack Compose can be handled either with a `MutableState`, `LiveData`, or `StateFlow`, which make the composables that observe it re-render when the value changes, making our UI dynamic. We also learned how to keep our projects tidy, and how to write maintainable composables and view models.

Even though it’s a relatively new technology, Jetpack Compose’s ecosystem is steadily growing, so we can expect to see a lot of libraries pop up that make it easier to create Jetpack Compose apps. With companies like Lyft, Twitter, Airbnb, Square, Reddit, and Firefox putting their trust into it, more and more developers will follow along and create apps, libraries and resources for Jetpack Compose.